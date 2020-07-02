const { S3 } = require('aws-sdk');
const config = {
    sslEnabled: false,
    endpoint: 'http://127.0.0.1:8000', // or 'localhost:8000'
    signatureCache: false,
    signatureVersion: 'v4',
    region: 'us-east-1',
    s3ForcePathStyle: true,
    accessKeyId: 'accessKey1',
    secretAccessKey: 'verySecretKey1',
};
const s3Client = new S3(config);
/* The following example creates a bucket. */
 var params = {
  Bucket: "examplebucket15",
  ObjectLockEnabledForBucket: true,
 };
 s3Client.createBucket(params, function(err, data) {
   if (err) console.log(err, err.stack); // an error occurred
   else     console.log(`dataaa: ${JSON.stringify(data,null,2)}`);           // successful response
   s3Client.getObjectLockConfiguration({ Bucket: "examplebucket15"}, (err, data) => console.log(`dataaa bucketsss: ${JSON.stringify(data,null,2)}`));
   /*
   data = {
    Location: "/examplebucket"
   }
   */
 }); 

