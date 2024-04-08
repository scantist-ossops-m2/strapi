'use strict';

const path = require('path');
const busboy = require('busboy');
const sharp = require('sharp');
const _ = require('lodash');
const utils = require('@strapi/utils');
const { getService } = require('../utils');
const { FILE_MODEL_UID } = require('../constants');
const validateUploadBody = require('./validation/content-api/upload');

const { sanitize, validate } = utils;
const { ValidationError } = utils.errors;

const sanitizeOutput = async (data, ctx) => {
  const schema = strapi.getModel(FILE_MODEL_UID);
  const { auth } = ctx.state;

  return sanitize.contentAPI.output(data, schema, { auth });
};

const validateQuery = async (data, ctx) => {
  const schema = strapi.getModel(FILE_MODEL_UID);
  const { auth } = ctx.state;

  return validate.contentAPI.query(data, schema, { auth });
};

const sanitizeQuery = async (data, ctx) => {
  const schema = strapi.getModel(FILE_MODEL_UID);
  const { auth } = ctx.state;

  return sanitize.contentAPI.query(data, schema, { auth });
};

module.exports = {
  async find(ctx) {
    await validateQuery(ctx.query, ctx);
    const sanitizedQuery = await sanitizeQuery(ctx.query, ctx);

    const files = await getService('upload').findMany(sanitizedQuery);

    ctx.body = await sanitizeOutput(files, ctx);
  },

  async findOne(ctx) {
    const {
      params: { id },
    } = ctx;

    await validateQuery(ctx.query, ctx);
    const sanitizedQuery = await sanitizeQuery(ctx.query, ctx);

    const file = await getService('upload').findOne(id, sanitizedQuery.populate);

    if (!file) {
      return ctx.notFound('file.notFound');
    }

    ctx.body = await sanitizeOutput(file, ctx);
  },

  async destroy(ctx) {
    const {
      params: { id },
    } = ctx;

    const file = await getService('upload').findOne(id);

    if (!file) {
      return ctx.notFound('file.notFound');
    }

    await getService('upload').remove(file);

    ctx.body = await sanitizeOutput(file, ctx);
  },

  async updateFileInfo(ctx) {
    const {
      query: { id },
      request: { body },
    } = ctx;
    const data = await validateUploadBody(body);

    const result = await getService('upload').updateFileInfo(id, data.fileInfo);

    ctx.body = await sanitizeOutput(result, ctx);
  },

  async replaceFile(ctx) {
    const {
      query: { id },
      request: { body, files: { files } = {} },
    } = ctx;

    // cannot replace with more than one file
    if (Array.isArray(files)) {
      throw new ValidationError('Cannot replace a file with multiple ones');
    }

    const replacedFiles = await getService('upload').replace(id, {
      data: await validateUploadBody(body),
      file: files,
    });

    ctx.body = await sanitizeOutput(replacedFiles, ctx);
  },

  async uploadFiles(ctx) {
    const {
      request: { body, files: { files } = {} },
    } = ctx;

    // const data = await validateUploadBody(body, Array.isArray(files));

    // const apiUploadFolderService = getService('api-upload-folder');

    // const apiUploadFolder = await apiUploadFolderService.getAPIUploadFolder();

    // if (Array.isArray(files)) {
    //   data.fileInfo = data.fileInfo || [];
    //   data.fileInfo = files.map((_f, i) => ({ ...data.fileInfo[i], folder: apiUploadFolder.id }));
    // } else {
    //   data.fileInfo = { ...data.fileInfo, folder: apiUploadFolder.id };
    // }

    // const uploadedFiles = await getService('upload').upload({
    //   data,
    //   files,
    // });

    // ctx.body = await sanitizeOutput(uploadedFiles, ctx);

    /*

    1. for each file
      - validate allowed mimetype
      - validate allowed size

      - create a transformation & upload stream for each file
      - pipe the file to the transformation
      - pipe the transformation to the upload stream

      - push in an array the metadatas of the file

    2. store metadatas in a database
      - read the fileInfo from the request
      - combine the fileInfo with the metadatas
      - store in the database

    */

    const onFile = async (fieldname, fileStream, filename, encoding, mimetype) => {
      console.log('File:', fieldname, filename);

      // file.pause();

      const { optimize, isImage, isFaultyImage, isOptimizableImage } = strapi
        .plugin('upload')
        .service('image-manipulation');

      const currentFile = {
        name: filename,
        type: mimetype,
        ext: path.extname(filename),
        // size: file.length,
        getStream: () => fileStream,
      };

      if (await isImage(currentFile)) {
        const pipeline = sharp();
        currentFile.getStream().pipe(pipeline);
        currentFile.getStream = () => pipeline.clone();

        if (await isFaultyImage(currentFile)) {
          throw new Error('File is not a valid image');
        }

        if (await isOptimizableImage(currentFile)) {
          return optimize(currentFile);
        }
      }

      // file.resume();
    };

    const req = ctx.req;
    const bb = busboy({ headers: req.headers });

    const p = () =>
      new Promise((resolve, reject) => {
        bb.on('file', onFile);

        bb.on('finish', () => {
          console.log('Done parsing form!');
          resolve();
        });

        bb.on('error', (err) => {
          console.log('Error parsing form:', err);
          reject(err);
        });

        bb.on('close', () => {
          console.log('close');
        });

        req.pipe(bb);
      });

    await p();

    ctx.body = [];
  },

  async upload(ctx) {
    const {
      query: { id },
      request: { files: { files } = {} },
    } = ctx;

    if (_.isEmpty(files) || files.size === 0) {
      if (id) {
        return this.updateFileInfo(ctx);
      }

      throw new ValidationError('Files are empty');
    }

    await (id ? this.replaceFile : this.uploadFiles)(ctx);
  },
};
