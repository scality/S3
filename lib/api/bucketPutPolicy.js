const async = require('async');
const { errors, models } = require('arsenal');

const collectCorsHeaders = require('../utilities/collectCorsHeaders');
const metadata = require('../metadata/wrapper');
const { metadataValidateBucket } = require('../metadata/metadataUtils');
const { validatePolicyResource } =
    require('./apiUtils/authorization/permissionChecks');
const { BucketPolicy } = models;

/**
 * bucketPutPolicy - create or update a bucket policy
 * @param {AuthInfo} authInfo - Instance of AuthInfo class with requester's info
 * @param {object} request - http request object
 * @param {object} log - Werelogs logger
 * @param {function} callback - callback to server
 * @return {undefined}
 */
function bucketPutPolicy(authInfo, request, log, callback) {
    log.debug('processing request', { method: 'bucketPutPolicy' });

    const { bucketName } = request;
    const metadataValParams = {
        authInfo,
        bucketName,
        requestType: 'bucketPutPolicy',
    };

    return async.waterfall([
        next => {
            const bucketPolicy = new BucketPolicy(request.post);
            // if there was an error getting bucket policy,
            // returned policyObj will contain 'error' key
            process.nextTick(() => {
                const policyObj = bucketPolicy.getBucketPolicy();
                if (policyObj.error) {
                    const err = errors.MalformedPolicy.customizeDescription(
                        policyObj.error.description);
                    return next(err);
                }
                return next(null, policyObj);
            });
        },
        (bucketPolicy, next) => {
            process.nextTick(() => {
                if (!validatePolicyResource(bucketName, bucketPolicy)) {
                    return next(errors.MalformedPolicy.customizeDescription(
                        'Policy has invalid resource'));
                }
                return next(null, bucketPolicy);
            });
        },
        (bucketPolicy, next) => metadataValidateBucket(metadataValParams, log,
            (err, bucket) => {
                if (err) {
                    return next(err, bucket);
                }
                return next(null, bucket, bucketPolicy);
            }),
        (bucket, bucketPolicy, next) => {
            bucket.setBucketPolicy(bucketPolicy);
            metadata.updateBucket(bucket.getName(), bucket, log,
                err => next(err, bucket));
        },
    ], (err, bucket) => {
        const corsHeaders = collectCorsHeaders(request.headers.origin,
            request.method, bucket);
        if (err) {
            log.trace('error processing request',
                { error: err, method: 'bucketPutPolicy' });
            return callback(err, corsHeaders);
        }
        // TODO: implement Utapi metric support
        return callback(null, corsHeaders);
    });
}

module.exports = bucketPutPolicy;
