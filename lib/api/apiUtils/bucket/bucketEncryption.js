const { errors } = require('arsenal');
const { parseString } = require('xml2js');


function parseEncryptionXml(xml, log, cb) {
    parseString(xml, (err, result) => {
        if (err) {
            log.trace('xml parsing failed', {
                error: err,
                method: 'parseEncryptionXml',
            });
            log.debug('invalid xml', { xml });
            return cb(errors.MalformedXML);
        }
        console.log(JSON.stringify(result, null, 4));
        cb(null, result);
    });
}

function parseBucketEncryptionHeaders(headers) {
    const sseAlgorithm = headers['x-amz-scal-server-side-encryption'];
    const sseMasterKeyId = headers['x-amz-scal-server-side-encryption-aws-kms-key-id'];

    if (sseAlgorithm === 'AES256') {
        return {
            algorithm: sseAlgorithm,
        };
    } else if (sseAlgorithm === 'aws:kms') {
        return {
            algorithm: 'aws:kms',
            configuredMasterKeyId: sseMasterKeyId,
        }
    }
}

function initEncryptedBucket(config, cb) {

}

module.exports = {
    parseEncryptionXml,
    parseBucketEncryptionHeaders
};
