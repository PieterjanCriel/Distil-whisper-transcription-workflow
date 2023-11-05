#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WhisperStepFunctionStack } from '../lib/whisper-step-function-stack';

const app = new cdk.App();
new WhisperStepFunctionStack(app, 'WhisperStepFunctionStack', {
    whisperEndpointName: 'distil-whisper-async',
});
