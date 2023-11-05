#!/usr/bin/env python

import logging
import boto3
import json

logger = logging.getLogger()
logger.setLevel(logging.INFO)

client = boto3.client('mediaconvert', endpoint_url='https://usryickja.mediaconvert.eu-central-1.amazonaws.com')

def lambda_handler(event, context):
    logger.info('got event: {}'.format(event))
    body = json.loads(event['body'])
    job_id = body['Job']['Id']
    
    response = client.get_job(Id=job_id)
    job_status = response['Job']['Status']

    if job_status == 'COMPLETE':
        status = 'SUCCEEDED'
        output_path = response['Job']['Settings']['OutputGroups'][0]['OutputGroupSettings']['FileGroupSettings']['Destination']
        extension = "mp4"
    elif job_status == 'ERROR' or job_status == 'CANCELED':
        status = 'FAILED'
        output_path = None
        extension = None
    else:
        status = 'IN_PROGRESS'
        output_path = None
        extension = None

    logger.info(
        f"job_id: {job_id}, status: {status}, output_path: {output_path}, extension: {extension}")

    return {
        'status': status,
        'output_path': output_path,
        'extension': extension,
        'file_location': f"{output_path}.{extension}",
        'job_id': job_id
    }
