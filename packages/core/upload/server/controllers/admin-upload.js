'use strict';

const crypto = require('crypto');
const path = require('path');
const busboy = require('busboy');
const sharp = require('sharp');
const _ = require('lodash');
const { ApplicationError } = require('@strapi/utils').errors;
const { mapAsync } = require('@strapi/utils');
const { getService } = require('../utils');
const { ACTIONS, FILE_MODEL_UID } = require('../constants');
const validateUploadBody = require('./validation/admin/upload');
const { findEntityAndCheckPermissions } = require('./utils/find-entity-and-check-permissions');

module.exports = {
  async updateFileInfo(ctx) {
    const {
      state: { userAbility, user },
      query: { id },
      request: { body },
    } = ctx;

    const uploadService = getService('upload');
    const { pm } = await findEntityAndCheckPermissions(
      userAbility,
      ACTIONS.update,
      FILE_MODEL_UID,
      id
    );

    const data = await validateUploadBody(body);
    const file = await uploadService.updateFileInfo(id, data.fileInfo, { user });

    ctx.body = await pm.sanitizeOutput(file, { action: ACTIONS.read });
  },

  async replaceFile(ctx) {
    const {
      state: { userAbility, user },
      query: { id },
      request: { body, files: { files } = {} },
    } = ctx;

    const uploadService = getService('upload');
    const { pm } = await findEntityAndCheckPermissions(
      userAbility,
      ACTIONS.update,
      FILE_MODEL_UID,
      id
    );

    if (Array.isArray(files)) {
      throw new ApplicationError('Cannot replace a file with multiple ones');
    }

    const data = await validateUploadBody(body);
    const replacedFile = await uploadService.replace(id, { data, file: files }, { user });

    // Sign file urls for private providers
    const signedFile = await getService('file').signFileUrls(replacedFile);

    ctx.body = await pm.sanitizeOutput(signedFile, { action: ACTIONS.read });
  },

  async uploadFiles(ctx) {
    // const {
    //   // request: { body, files: { files } = {} },
    // } = ctx;

    const { user } = ctx.state;

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

    let promises = [];
    const data = {};

    const onFile = async (_, fileStream, info) => {
      // file.pause();

      // validate filename

      const { optimize, isImage, isFaultyImage, isOptimizableImage } = strapi
        .plugin('upload')
        .service('image-manipulation');

      const pipeline = sharp();
      fileStream.pipe(pipeline);

      // TODO: set some default field 1st
      let currentFile = {
        name: info.filename,
        type: info.mimeType,
        ext: path.extname(info.filename),
        hash: crypto.randomBytes(5).toString('hex'),
        // size: file.length,
        getStream: () => pipeline.clone(),
      };

      if (await isImage(currentFile)) {
        if (await isFaultyImage(currentFile)) {
          throw new Error('File is not a valid image');
        }

        if (await isOptimizableImage(currentFile)) {
          currentFile = await optimize(currentFile);
        }

        await getService('upload').uploadImage(currentFile);
      } else {
        await getService('provider').upload(currentFile);
      }

      return currentFile;
    };

    const req = ctx.req;
    const bb = busboy({ headers: req.headers });

    const p = () =>
      new Promise((resolve, reject) => {
        bb.on('file', (_, file, info) => {
          promises.push(onFile(_, file, info));
        });

        bb.on('field', (name, value) => {

          const parsedValue = JSON.parse(value);

          if (!data[name]) {
            data[name] = parsedValue;
          } else {
            data[name] = [data[name], parsedValue];
          }
        });

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

    const res = await Promise.all(promises);

    console.log(data);

    await Promise.all(
      res.map(async (result, idx) => {
        const info = data.fileInfo[idx];

        const config = strapi.config.get('plugin.upload');

        const entity = await getService('upload').formatFileInfo(
          {
            filename: result.name,
            type: result.type,
            size: 0,
          },
          info,
          {
            path: null,
          }
        );

        const f = {
          ...result,
          ...entity,
          provider: config.provider,
        };

        console.log(f);

        return getService('upload').add(f, { user });
      })
    );

    ctx.body = [];
  },

  async upload(ctx) {
    // const {
    //   query: { id },
    //   request: { files: { files } = {} },
    // } = ctx;

    // if (_.isEmpty(files) || files.size === 0) {
    //   if (id) {
    //     return this.updateFileInfo(ctx);
    //   }

    //   throw new ApplicationError('Files are empty');
    // }

    return this.uploadFiles(ctx);

    // await (id ? this.replaceFile : this.uploadFiles)(ctx);
  },
};
