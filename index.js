'use strict';

const s3 = require('s3'),
    fs = require('fs-extra'),
    dir = require('node-dir'),
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
  {
    file: '/polymer/polymer.html',
    package: 'polymer',
    cdn: '//polygit.org/polymer+:${version}/components/polymer/polymer.html'
  },
  {
    file: 'bower_components/es6-promise/es6-promise.min.js',
    package: 'es6-promise',
    cdn: '//cdnjs.cloudflare.com/ajax/libs/es6-promise/${version}/es6-promise.min.js'
  },
  {
    file: 'bower_components/webcomponentsjs/webcomponents-lite.js',
    package: 'webcomponentsjs',
    cdn: '//cdnjs.cloudflare.com/ajax/libs/webcomponentsjs/${version}/webcomponents-lite.min.js'
  }
];


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

// Given a list of Px- component names (px-modal, px-dropdown, etc)
// this function will add a cdnizer object to the 'strings' array
// for each component pointing to the cdn version of that component.
function addPxCdnStrings(strings, components){
  if(components && components.length > 0){
    for(let component in components){
      let c = components[component];
      strings.push({
        file: 'bower_components/'+c+'/'+c+'.html',
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
      options.dest = options.dest || './cdn/';
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

      // Empty the /cdn directory
      fs.emptyDirSync(options.dest);

      // Change Template Strings to point to CDN assets
      if(options.update){
        console.log('Rewriting strings in '+options.root+'. This may take some time');
      } else {
        console.log('Parsing '+options.root+'. This may take some time');
      }

      // TODO: excludeDir

      dir.readFiles(options.root, /*{ match: /\.(html|css|)$/ },*/ (err, content, filename, next) => {
        let thisFile = filename.split(options.root)[1] || filename;
        content = replaceStrings(content, cdnizer);
        options.files.map((file)=> {
          // Copy matched files to /cdn
          if(file === thisFile){
            fs.outputFileSync(options.dest + thisFile, content);
          }
        });
        if(options.update){
          // update paths in options.root
          fs.outputFileSync(filename, content) ;
        }
        next();
      }, (err) => {
        if(!err){
          // Upload files to S3 Bucket
          if(!options.dryrun && process.env.AWS_ACCESS_KEY && process.env.AWS_SECRET_ACCESS_KEY){
            uploadFiles(options);
          } else {
            console.log('Dry run completed.');
          }
        } else {
          console.log('Problem replacing template strings', err);
        }
      });
    } else {
      console.log('Please specify a version using the -v option');
    }
  }
};
