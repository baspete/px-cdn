'use strict';

const s3 = require('s3'),
    fs = require('fs-extra'),
    Vulcanize = require('vulcanize'),
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

// Default strings
let defaults = [
  // THIS IS NOT A CDN! WHERE CAN I GET POLYMER ITSELF?
  {
    file: 'polymer/polymer.html',
    package: 'polymer',
    cdn: '//polygit.org/polymer+:${version}/components/polymer/polymer.html'
  }
];

// END CONFIGURATION
// #######################################################

// #######################################################
// STRING REPLACEMENT

function fixPaths(content){
  // Get rid of '..' relative paths
  // ie: replace any number of '../' with a single '/'
  // We do this because cdnizer doesn't understand '../'
  // THIS IS SUPER-FRAGILE! DO WE ACTUALLY WANT TO GO DOWN THIS RABBIT HOLE?!
  return content.replace(/(\.\.\/)(iron-|polymer|px-)/g, '../bower_components/$2');
}

function replaceStrings(content, cdnizer){
  // Use public CDNs for open-source libraries & fonts
  // content = content.replace(fonts.fa.path, fonts.fa.cdn);
  // Replace GE fonts
  // content = content.replace(fonts.ge.path, fonts.ge.cdn);
  // Replace component/library URLs
  // content = cdnizer(content);
  // OK, we're done
  return content;
}

// Given a list of Px- component names (px-modal, px-dropdown, etc)
// this function will add a cdnizer object to the 'strings' array
// for each component pointing to the cdn version of that component.
// OBVIOUSLY THIS WILL ONLY WORK IF THE ASSETS ARE ON THE CDN!
function addPxCdnStrings(strings, components){
  if(components && components.length > 0){
    for(let component in components){
      let c = components[component];
      strings.push({
        file: c+'/'+c+'.html',
        package: c,
        cdn: '//' + endpoint + '/predixdev/'+c+'/${version}/'+c+'.html'
      });
    }
  }
  return strings;
}

// #######################################################
// S3 UPLOADER
// See https://www.npmjs.com/package/s3

function uploadFiles(options){

  let s3Config = {
    maxAsyncS3: 20,     // this is the default
    s3RetryCount: 3,    // this is the default
    s3RetryDelay: 1000, // this is the default
    multipartUploadThreshold: 20971520, // this is the default (20 MB)
    multipartUploadSize: 15728640, // this is the default (15 MB)
    s3Options: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      // any other options are passed to new AWS.S3()
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
    },
  };
  // If they've set a proxy, use it
  if(process.env.HTTP_PROXY){
    s3Config.s3Options.httpOptions = {
      proxy: process.env.HTTP_PROXY
    };
  }

  // This will create a client we can use to upload files to our bucket
  let s3Client = s3.createClient(s3Config);

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
    if(!options.dryrun){
      fs.remove(options.dest);
    }
  });
}

// #######################################################
// INIT

module.exports = {
  endpoint: endpoint,
  cdnify: (options) => {
    if(options.version){

      // Defaults
      options.dest = 'cdn/';
      options.root = options.root || './';
      options.strings = options.strings || [];
      // Add strings for px components
      options.strings = addPxCdnStrings(options.strings, options.px);
      // Add default strings
      options.strings = options.strings.concat(defaults);

      // Set up the 'cdnizer' package
      const cdnizer = cdnizerFactory({
        defaultCDNBase: '//' + endpoint + '/' + options.name,
        allowMin: false,
        files: options.strings
      });


      var vulcan = new Vulcanize({
        excludes: {
          imports: options.files
        },
        inlineScripts: true,
        inlineCss: true,
        stripComments: false
      });

      // Empty the /cdn directory
      fs.emptyDirSync(options.dest);

      // TODO: from Runn
      // 0. ../foo to bower_components/foo <-- THIS IS WHY I HATE HTML IMPORTS
      // 1. replace all strings for px- stuff to point to cdn. leave non-px stuff alone
      //    - might need to create a map instead
      // 2. vulcanize, excluding px-stuff
      // 3. upload vulcanized file
      // 4. apps use vulcanized file

      // Runn's wishlist:
      // 1. use json instead of js
      //   - get name & version from bower.json


      // Copy files from options.root to options.dest, changing dependency paths so they actually work
      for(let file in options.files){
        try {
          let content = fs.readFileSync(options.root + options.files[file], 'utf8');
          content = fixPaths(content);
          fs.outputFileSync(options.dest + options.files[file], content);
        } catch(err){
          console.log('No file found at ', options.root + options.files[file], ', skipping.');
        }
      }

      // vulcanize and change references
      vulcan.process(options.dest + options.name + '.html', function(err, inlinedHtml) {
        if(!err){
          inlinedHtml = replaceStrings(inlinedHtml, cdnizer);
          fs.outputFileSync(options.dest + options.name + '.vulcanized.html', inlinedHtml);
        }
      });

      // Upload files to S3 Bucket
      if(!options.dryrun && process.env.AWS_ACCESS_KEY && process.env.AWS_SECRET_ACCESS_KEY){
        uploadFiles(options);
      } else {
        console.log('Dry run completed. Files are in', options.dest);
      }
    } else {
      console.log('Please specify a version using the -v option');
    }
  }
};
