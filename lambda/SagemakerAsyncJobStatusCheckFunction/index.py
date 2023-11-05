import boto3
import json
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the S3 client
s3_client = boto3.client('s3')

def lambda_handler(event, context):
    # Extract the S3 bucket and key from the event
    output_location = event['OutputLocation']
    failure_location = event['FailureLocation']
    
    # Parse the S3 URLs
    output_bucket, output_key = parse_s3_url(output_location)
    failure_bucket, failure_key = parse_s3_url(failure_location)


    try:
        # Check if the output file exists
        logger.info(f'Checking for output file at s3://{output_bucket}/{output_key}')
        s3_client.head_object(Bucket=output_bucket, Key=output_key)
        return {
            'status': 'success',
            'message': 'Output is available.',
            'InferenceId': event['InferenceId'],
            'OutputLocation': output_location,
            'FailureLocation': failure_location
        }
    except ClientError as e:
        logger.info(f'Error: {e}')
        if e.response['Error']['Code'] == '404':
            # The output file was not found, now check for the failure file
            try:
                logger.info(f'Checking for failure file at s3://{failure_bucket}/{failure_key}')
                s3_client.head_object(Bucket=failure_bucket, Key=failure_key)
                return {
                    'status': 'failure',
                    'message': 'Failure file found.',
                    'InferenceId': event['InferenceId'],
                    'OutputLocation': output_location,
                    'FailureLocation': failure_location
                }
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    # Neither output nor failure file was found, return in_progress
                    return {
                        'status': 'in_progress',
                        'message': 'No output or failure file found yet.',
                        'InferenceId': event['InferenceId'],
                        'OutputLocation': output_location,
                        'FailureLocation': failure_location
                    }
                else:
                    # Handle unexpected errors
                    raise e
        else:
            # Handle other errors from the output bucket check
            raise e

def parse_s3_url(s3_url):
    """
    Parse the S3 URL to get the bucket and key.
    
    :param s3_url: str, The S3 URL to be parsed.
    :return: tuple, (bucket, key)
    """
    # Remove the s3:// prefix
    s3_path = s3_url.replace('s3://', '')
    
    # Split into bucket and key
    parts = s3_path.split('/', 1)
    logger.info(f'parts: {parts}')
    return parts[0], parts[1]

