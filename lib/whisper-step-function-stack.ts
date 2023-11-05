import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Duration, StackProps, Stack } from 'aws-cdk-lib';
import { ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import {
    StateMachine,
    Choice,
    Fail,
    Succeed,
    Wait,
    WaitTime,
    Condition,
    CustomState,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import path = require('path');

interface WhisperStepFunctionStackProps extends StackProps {
    whisperEndpointName: string;
}

export class WhisperStepFunctionStack extends Stack {
    constructor(scope: Construct, id: string, props?: WhisperStepFunctionStackProps) {
        super(scope, id, props);

        if (!props?.whisperEndpointName) {
            throw new Error('Whisper endpoint name is required');
        }

        const mediaConvertInputBucket = new Bucket(this, 'MediaConvertInputBucket', {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        const mediaConvertOutputBucket = new Bucket(this, 'MediaConvertOutputBucket', {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        const whisperOutputBucket = new Bucket(this, 'WhisperOutputBucket', {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        const mediaConvertRole = new Role(this, 'ConvertRole', {
            assumedBy: new ServicePrincipal('mediaconvert.amazonaws.com'),
        });

        mediaConvertInputBucket.grantRead(mediaConvertRole);
        mediaConvertOutputBucket.grantWrite(mediaConvertRole);

        const lambdaConvertRole = new Role(this, 'LambdaRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });

        const mediaConvertPolicy = new Policy(this, 'cw-logs', {
            statements: [
                new PolicyStatement({
                    actions: ['mediaconvert:*'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: [mediaConvertRole.roleArn],
                }),
            ],
        });

        lambdaConvertRole.attachInlinePolicy(mediaConvertPolicy);
        mediaConvertInputBucket.grantReadWrite(lambdaConvertRole);
        mediaConvertOutputBucket.grantReadWrite(lambdaConvertRole);

        const mediaConvertLambda = new PythonFunction(this, 'ConvertFunction', {
            runtime: Runtime.PYTHON_3_9,
            memorySize: 128,
            description: 'Lambda to manage media convertion jobs',
            timeout: Duration.seconds(120),
            role: lambdaConvertRole,
            index: 'index.py',
            handler: 'lambda_handler',
            entry: path.join(__dirname, '..', 'lambda', 'MediaConvertFunction'),
            environment: {
                DestinationBucket: mediaConvertOutputBucket.bucketName,
                MediaConvertRole: mediaConvertRole.roleArn,
                Application: 'media-convert-application',
                AWS_REGION: this.region,
            },
        });

        const lambdaConvertStatusCheckRole = new Role(this, 'LambdaStatusCheckRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });

        const mediaConvertStatusCheckPolicy = new Policy(this, 'cw-status-check-logs', {
            statements: [
                new PolicyStatement({
                    actions: ['mediaconvert:*'], // change to list jobs only
                    resources: ['*'],
                }),
                new PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: ['*'],
                }),
            ],
        });

        lambdaConvertStatusCheckRole.attachInlinePolicy(mediaConvertStatusCheckPolicy);

        const mediaConvertStatusCheckLambda = new PythonFunction(this, 'StatusCheckFunction', {
            runtime: Runtime.PYTHON_3_9,
            memorySize: 128,
            description: 'Lambda to check media convertion jobs status',
            timeout: Duration.seconds(10),
            role: lambdaConvertRole,
            index: 'index.py',
            handler: 'lambda_handler',
            entry: path.join(__dirname, '..', 'lambda', 'MediaConvertStatusCheckFunction'),
        });

        const sagemakerAsyncJobStatusCheckRole = new Role(this, 'SagemakerAsyncJobStatusCheckRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });

        const sagemakerAsyncJobStatusCheckPolicy = new Policy(this, 'sagemaker-async-job-status-check-logs', {
            statements: [
                new PolicyStatement({
                    actions: ['s3:ListBucket', 's3:headObject'],
                    resources: [whisperOutputBucket.bucketArn],
                }),
            ],
        });

        sagemakerAsyncJobStatusCheckRole.attachInlinePolicy(sagemakerAsyncJobStatusCheckPolicy);

        const sagemakerAsyncJobStatusCheckLambda = new PythonFunction(this, 'SagemakerAsyncJobStatusCheckFunction', {
            runtime: Runtime.PYTHON_3_9,
            memorySize: 128,
            description: 'Lambda to check SageMaker async jobs status',
            timeout: Duration.seconds(10),
            role: sagemakerAsyncJobStatusCheckRole,
            index: 'index.py',
            handler: 'lambda_handler',
            entry: path.join(__dirname, '..', 'lambda', 'SagemakerAsyncJobStatusCheckFunction'),
        });

        // Creating the State Machine

        const jobFailed = new Fail(this, 'WhisperTranscriptJobFailed', {
            stateName: 'WhisperTranscriptJobFailed',
            cause: 'Whisper Transcription Job Failed',
            error: 'Job returned FAILED',
        });

        const jobSucceeded = new Succeed(this, 'WhisperTranscriptJobSucceeded', {
            stateName: 'WhisperTranscriptJobSucceeded',
        });

        const trigger_media_convert_lambda = new LambdaInvoke(this, 'TriggerMediaConvertLambda', {
            lambdaFunction: mediaConvertLambda,
            payloadResponseOnly: true,
            stateName: 'TriggerMediaConvertLambda'
        });

        const check_media_convert_status_lambda = new LambdaInvoke(this, 'CheckMediaConvertStatusLambda', {
            lambdaFunction: mediaConvertStatusCheckLambda,
            payloadResponseOnly: true,
            stateName: 'CheckMediaConvertStatusLambda'
        });

        const check_sagemaker_async_job_status_lambda = new LambdaInvoke(this, 'CheckSagemakerAsyncJobStatusLambda', {
            lambdaFunction: sagemakerAsyncJobStatusCheckLambda,
            payloadResponseOnly: true,
            stateName: 'CheckSagemakerAsyncJobStatusLambda'
        });

        const invokeWhisperAsyncInference = new CustomState(this, 'InvokeWhisperAsyncInference', {
            stateJson: {
              Type: "Task",
              Parameters: {
                EndpointName : props.whisperEndpointName,
                ContentType : "audio/x-audio",
                InvocationTimeoutSeconds : Duration.seconds(900).toSeconds(),
                "InputLocation.$" : "$.file_location"
              },
              Resource: "arn:aws:states:::aws-sdk:sagemakerruntime:invokeEndpointAsync"
            },
        });

        const waitForMediaConvertJobStatus = new Wait(this, 'WaitForMediaConvertJobStatus', {
            time: WaitTime.duration(Duration.seconds(15)),
            stateName: 'WaitForMediaConvertJobStatus',
        });

        const waitForSagemakerAsyncJobStatus = new Wait(this, 'WaitForSagemakerAsyncJobStatus', {
            time: WaitTime.duration(Duration.seconds(15)),
            stateName: 'WaitForSagemakerAsyncJobStatus',
        });

        const mediaConvertJobStateChoice = new Choice(this, 'MediaConvertJobStateChoice', {
            stateName: 'MediaConvertJobStateChoice',
        });

        const sagemakerAsyncJobStateChoice = new Choice(this, 'SagemakerAsyncJobStateChoice', {
            stateName: 'SagemakerAsyncJobStateChoice',
        });

        const definition = trigger_media_convert_lambda
            .next(waitForMediaConvertJobStatus)
            .next(check_media_convert_status_lambda)
            .next(
                mediaConvertJobStateChoice
                    .when(
                        Condition.stringEquals('$.status', 'SUCCEEDED'),
                        invokeWhisperAsyncInference
                            .next(waitForSagemakerAsyncJobStatus)
                            .next(check_sagemaker_async_job_status_lambda)
                            .next(
                                sagemakerAsyncJobStateChoice
                                    .when(Condition.stringEquals('$.status', 'success'), jobSucceeded)
                                    .when(Condition.stringEquals('$.status', 'failed'), jobFailed)
                                    .otherwise(waitForSagemakerAsyncJobStatus),
                            ),
                    )
                    .when(Condition.stringEquals('$.status', 'FAILED'), jobFailed)
                    .otherwise(waitForMediaConvertJobStatus),
            );

        const stateMachine = new StateMachine(this, 'WhisperTranscriptStateMachine', {
            definition,
            timeout: Duration.minutes(15),
            stateMachineName: 'WhisperTranscriptStateMachine',
            role: new Role(this, 'StateMachineRole', {
                assumedBy: new ServicePrincipal('states.amazonaws.com'),
                managedPolicies: [
                    ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole'),
                    ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
                ],
            }),
        });
    }
}
