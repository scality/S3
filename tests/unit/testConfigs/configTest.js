const assert = require('assert');
const arsenal = require('arsenal');
const utils = arsenal.storage.data.external.backendUtils;
const BucketInfo = require('arsenal').models.BucketInfo;

const { config } = require('../../../lib/Config');

const userBucketOwner = 'Bart';
const creationDate = new Date().toJSON();
const serverSideEncryption = { cryptoScheme: 123, algorithm: 'algo',
masterKeyId: 'masterKeyId', mandatory: false };
const bucketOne = new BucketInfo('bucketone',
  userBucketOwner, userBucketOwner, creationDate,
  BucketInfo.currentModelVersion());
const bucketTwo = new BucketInfo('buckettwo',
  userBucketOwner, userBucketOwner, creationDate,
  BucketInfo.currentModelVersion());
const bucketOnetWithEncryption = new BucketInfo('bucketone',
    userBucketOwner, userBucketOwner, creationDate,
    BucketInfo.currentModelVersion(), undefined, undefined, undefined,
    serverSideEncryption);
const bucketTwoWithEncryption = new BucketInfo('buckettwo',
    userBucketOwner, userBucketOwner, creationDate,
    BucketInfo.currentModelVersion(), undefined, undefined, undefined,
    serverSideEncryption);

const results = [
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'azurebackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: true,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend2',
    destLocationConstraintName: 'azurebackend2',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: true,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'awsbackend',
    destLocationConstraintName: 'awsbackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: true,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'awsbackend',
    destLocationConstraintName: 'awsbackend2',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: true,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'awsbackend2',
    destLocationConstraintName: 'awsbackend2',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: true,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'scality-internal-mem',
    destLocationConstraintName: 'scality-internal-mem',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'scality-internal-mem',
    destLocationConstraintName: 'azurebackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'scality-internal-mem',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'awsbackend',
    destLocationConstraintName: 'scality-internal-mem',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'scality-internal-mem',
    destLocationConstraintName: 'awsbackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'awsbackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'azurebackend2',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketOne,
    boolExpected: false,
    description: 'same bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'azurebackend',
    sourceBucketMD: bucketOne,
    destBucketMD: bucketTwo,
    boolExpected: true,
    description: 'different non-encrypted bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'azurebackend',
    sourceBucketMD: bucketOnetWithEncryption,
    destBucketMD: bucketOnetWithEncryption,
    boolExpected: true,
    description: 'same encrypted bucket metadata',
  },
  { sourceLocationConstraintName: 'azurebackend',
    destLocationConstraintName: 'azurebackend',
    sourceBucketMD: bucketOnetWithEncryption,
    destBucketMD: bucketTwoWithEncryption,
    boolExpected: false,
    description: 'different encrypted bucket metadata',
  },
];

describe('Testing Config.js function: ', () => {
    results.forEach(result => {
        it(`should return ${result.boolExpected} if source location ` +
        `constraint === ${result.sourceLocationConstraintName} ` +
        'and destination location constraint ===' +
        ` ${result.destLocationConstraintName} and ${result.description}`,
        done => {
            const isCopy = utils.externalBackendCopy(config,
              result.sourceLocationConstraintName,
              result.destLocationConstraintName, result.sourceBucketMD,
              result.destBucketMD);
            assert.strictEqual(isCopy, result.boolExpected);
            done();
        });
    });
});
