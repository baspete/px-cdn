'use strict';

const s3 = require('s3'),
    fs = require('fs-extra'),
    cdnizerFactory = require('cdnizer');

// #######################################################
// CONFIGURATION

// S3/CloudFront properties
const endpoint = 'dzlpbrbc7yvq0.cloudfront.net',
      bucket = 'apmcdn';

// Which fonts are you using (you probably don't need to change this)
// Note the regex here. It matches:
// - zero or more '../'
// - zero or more 'bower_components/'
// - an empty string
const fonts = {
  ge: {
    path: /(|(\.\.\/|bower_components\/)*)px-typography-design\/type\//g,
    cdn: '//' + endpoint + '/predixdev/fonts/1.0.0/'
  },
  fa: {
    path: /(|(\.\.\/|bower_components\/)*)font-awesome\//g,
    cdn: '//cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.3/'
  }
};

// END CONFIGURATION
// #######################################################

// #######################################################
// STRING REPLACEMENT

function replaceStrings(content, cdnizer){
  // Get rid of '..' relative paths
  // ie: replace any number of '../' with a single '/'
  // We do this because cdnizer doesn't understand '../'
  content = content.replace(/(\.\.\/)/g, '/');
  // Use public CDNs for open-source libraries & fonts
  content = content.replace(fonts.fa.path, fonts.fa.cdn);
  // Replace GE fonts
  content = content.replace(fonts.ge.path, fonts.ge.cdn);
  // Replace component/library URLs
  content = cdnizer(content);
  // OK, we're done
  return content;
}

// #######################################################
// S3 UPLOADER
// See https://www.npmjs.com/package/s3

function uploadFiles(options){

  const s3Client = s3.createClient({
    maxAsyncS3: 20,     // this is the default
    s3RetryCount: 3,    // this is the default
    s3RetryDelay: 1000, // this is the default
    multipartUploadThreshold: 20971520, // this is the default (20 MB)
    multipartUploadSize: 15728640, // this is the default (15 MB)
    s3Options: {
      accessKeyId: options.credentials.accessKeyId || process.env.AWS_ACCESS_KEY,
      secretAccessKey: options.credentials.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
      httpOptions: {
        proxy: options.proxy || process.env.HTTP_PROXY
      }
      // any other options are passed to new AWS.S3()
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
    },
  });

  const params = {
    localDir: options.dest, // which files to send to CDN
    deleteRemoved: true,
    s3Params: {
      Bucket: bucket,
      // Path will be //<cdn>/<name>/<version>/
      Prefix: options.name + '/' + options.version + '/',
      'CacheControl': 'max-age=31536000, no-transform, public', // 1y
      // other options supported by putObject, except Body and ContentLength.
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
    }
  };

  s3Client.uploadDir(params).on('error', function(err) {
    console.error('unable to upload build:', err);
  }).on('end', function() {
    console.log('uploaded', this.filesFound, 'files to', endpoint + '/' + options.name + '/' + options.version + '/');
    fs.remove(options.dest);
  });
}

// #######################################################
// INIT

module.exports = {
  endpoint: endpoint,
  cdnify: (options) => {

    if(options.version){

      // Defaults
      options.dest = options.dest || './cdn/';

      // Set up the 'cdnizer' package
      const cdnizer = cdnizerFactory({
        defaultCDNBase: '//' + endpoint + '/' + options.name,
        allowMin: false,
        files: options.strings
      });

      // Empty the /cdn directory
      fs.emptyDirSync(options.dest);
      // Change Template Strings to point to CDN assets

      for(let file in options.files){
        try {
          let content = fs.readFileSync(options.root + options.files[file], 'utf8');
          content = replaceStrings(content, cdnizer);
          fs.outputFileSync(options.dest + options.files[file], content);
        } catch(err){
          console.log('No file found at ', options.root + options.files[file], ', skipping.');
        }
      }
      // Upload files to S3 Bucket
      if(!options.dryrun){
        uploadFiles(options);
      }
    } else {
      console.log('Please specify a version using the -v option');
    }
  }
};
