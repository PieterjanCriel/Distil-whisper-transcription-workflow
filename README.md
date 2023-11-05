# Workflow to create Distil Whisper transcriptions for video files

[Medium article](https://pjcr.medium.com/distil-whisper-transcriptions-with-aws-step-function-and-elemental-media-convert-a85529eedc3e)

Distil-Whisper was proposed in the paper Robust Knowledge Distillation via Large-Scale Pseudo Labelling (Submitted on 1 Nov 2023). It is a distilled version of the Whisper model that is 6 times faster, 49% smaller, and performs within 1% WER on out-of-distribution evaluation sets. The Whisper models approach human level robustness and accuracy on speech recognition, That makes these models great candidates to create transcriptions of videos and/or recorded meetings.

![whisper](https://github.com/PieterjanCriel/Distil-whisper-transcription-workflow/assets/9216903/0f86102e-1dcf-401c-b4ef-ea798b956167)


The pipeline gets triggered based on a new video file, e.g. when a file is uploaded to an S3 bucket. A first lambda method will create a job to extract the audio based on a pre-defined job-template and submit this job to AWS Media convert. While the job is processing, another lambda method checks the status. As long as the job is still processing, the chain will jump back to the waiting state. If the media conversion failed, the pipeline jump the the final fail state, if successful, we can proceed with the actual transcription.
Amazon SageMaker Asynchronous Inference is a feature within SageMaker that manages incoming requests by placing them in a queue for asynchronous processing. This option is ideal for requests with large payload sizes (up to 1GB), long processing times (up to one hour). Asynchronous Inference enables you to save on costs by autoscaling the instance count to zero when there are no requests to process, so you only pay when your endpoint is processing requests.
Upon invoking an asynchronous endpoint in Amazon SageMaker, the service responds with a accepted confirmation that includes the Amazon S3 location designated as outputLocation. This is where the results of the inference will be stored once completed. The InferenceId allows you to track the processing status and ultimately retrieve the inference output from the specified S3 bucket, once it becomes available. If the requests would fail, the error will be stored on S3 as well.
Similarly to the Media Convert job, a job polling pattern is implemented to track the state of the inference request.
But before an asynchronous inference request can be made on a stripped audio file, an actual Distil-Whisper model needs to be deployed first.


## Deploy the Distil Whisper endpoint
The `notebooks/distil-whisper-deploy.ipynb` notebook can be used to deploy an asynchronous Distil-Whisper endpoint on AWS Sagemaker. Deploying such a model with pure CDK is not as straighforward as via a notebook. If you do want to create such an endpoint with CDK than you can find some inspiration [here](https://medium.com/@pjcr/expensive-cat-pictures-with-stable-diffusion-on-aws-sagemaker-in-cdk-9ae3cfdbf0ef) (Creating a construct for HuggingFace hosted models).  


