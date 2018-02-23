const werelogs = require('werelogs');
const { errors, s3middleware } = require('arsenal');

const _config = require('../../../Config').config;
const { logHelper } = require('../utils');
const { gcpTaggingPrefix } = require('../../../../constants');

werelogs.configure({
    level: _config.log.logLevel,
    dump: _config.log.dumpLevel,
});

const logger = new werelogs.Logger('gcpUtil');

class JsonError extends Error {
    constructor(type, code, desc) {
        super(type);
        this.code = code;
        this.description = desc;
        this[type] = true;
    }
}

function jsonRespCheck(err, resp, body, method, callback) {
    if (err) {
        logHelper(logger, 'error',
            `${method}: error in json method`,
            errors.InternalError.customizeDescription('json method failed'));
        return callback(errors.InternalError
            .customizeDescription('error in JSON Request'));
    }
    if (resp.statusCode >= 300) {
        return callback(
            new JsonError(resp.statusMessage, resp.statusCode));
    }
    let res;
    try {
        res = body && typeof body === 'string' ?
            JSON.parse(body) : body;
    } catch (error) { res = undefined; }
    if (res && res.error && res.error.code >= 300) {
        return callback(
            new JsonError(res.error.message, res.error.code));
    }
    return callback(null, res);
}

function eachSlice(size) {
    this.array = [];
    let partNumber = 1;
    for (let ind = 0; ind < this.length; ind += size) {
        this.array.push({
            Parts: this.slice(ind, ind + size),
            PartNumber: partNumber++,
        });
    }
    return this.array;
}

function getSourceInfo(CopySource) {
    const source =
        CopySource.startsWith('/') ? CopySource.slice(1) : CopySource;
    const sourceArray = source.split(/\/(.+)/);
    const sourceBucket = sourceArray[0];
    const sourceObject = sourceArray[1];
    return { sourceBucket, sourceObject };
}

function getRandomInt(min, max) {
    const minVal = Math.ceil(min);
    const maxVal = Math.floor(max);
    return Math.floor(Math.random() * (maxVal - minVal)) + minVal;
}

function getPaddedPartNumber(number) {
    return `000000${number}`.substr(-5);
}

function createMpuKey(key, uploadId, partNumberArg, fileNameArg) {
    let partNumber = partNumberArg;
    let fileName = fileNameArg;

    if (typeof partNumber === 'string' && fileName === undefined) {
        fileName = partNumber;
        partNumber = null;
    }
    const paddedNumber = getPaddedPartNumber(partNumber);
    if (fileName && typeof fileName === 'string') {
        // if partNumber is given, return a "full file path"
        // else return a "directory path"
        return partNumber ? `${key}-${uploadId}/${fileName}/${paddedNumber}` :
            `${key}-${uploadId}/${fileName}`;
    }
    if (partNumber && typeof partNumber === 'number') {
        // filename wasn't passed as an argument. Create default
        return `${key}-${uploadId}/parts/${paddedNumber}`;
    }
    // returns a "directory path"
    return `${key}-${uploadId}/`;
}

function createMpuList(params, level, size) {
    // populate and return a parts list for compose
    const retList = [];
    for (let i = 1; i <= size; ++i) {
        const paddedNumber = getPaddedPartNumber(i);
        retList.push({
            PartName:
                `${params.Key}-${params.UploadId}/${level}/${paddedNumber}`,
            PartNumber: i,
        });
    }
    return retList;
}

function processTagSet(tagSet = []) {
    if (tagSet.length > 10) {
        return errors.BadRequest
            .customizeDescription('Object tags cannot be greater than 10');
    }
    const tagAsMeta = {};
    const taggingDict = {};
    for (let i = 0; i < tagSet.length; ++i) {
        const { Key: key, Value: value } = tagSet[i];
        if (key.length > 128) {
            return errors.InvalidTag.customizeDescription(
                'The TagKey you have provided is invalid');
        }
        if (value.length > 256) {
            return errors.InvalidTag.customizeDescription(
                'The TagValue you have provided is invalid');
        }
        if (taggingDict[key]) {
            return errors.InvalidTag.customizeDescription(
                'Cannot provide multiple Tags with the same key');
        }
        tagAsMeta[`${gcpTaggingPrefix}${key}`] = value;
        taggingDict[key] = true;
    }
    return tagAsMeta;
}

function stripTags(metadata = {}) {
    const retMD = Object.assign({}, metadata);
    Object.keys(retMD).forEach(key => {
        if (key.startsWith(gcpTaggingPrefix)) {
            delete retMD[key];
        }
    });
    return retMD;
}

function retrieveTags(metadata = {}) {
    const retTagSet = [];
    Object.keys(metadata).forEach(key => {
        if (key.startsWith(gcpTaggingPrefix)) {
            retTagSet.push({
                Key: key.slice(gcpTaggingPrefix.length),
                Value: metadata[key],
            });
        }
    });
    return retTagSet;
}

function getPutTagsMetadata(metadata, tagging = '') {
    let retMetadata = metadata || {};
    retMetadata = stripTags(retMetadata);
    const tagObj = s3middleware.tagging.parseTagFromQuery(tagging);
    Object.keys(tagObj).forEach(header => {
        const prefixed = `${gcpTaggingPrefix}${header}`.toLowerCase();
        retMetadata[prefixed] = tagObj[header];
    });
    return retMetadata;
}

module.exports = {
    // functions
    eachSlice,
    getRandomInt,
    createMpuKey,
    createMpuList,
    getSourceInfo,
    jsonRespCheck,
    processTagSet,
    stripTags,
    retrieveTags,
    getPutTagsMetadata,
    // util objects
    JsonError,
    logger,
};
