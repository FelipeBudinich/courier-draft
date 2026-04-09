import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const scriptSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      default: 'draft'
    },
    sceneNumberMode: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto'
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

scriptSchema.plugin(publicIdPlugin, { prefix: 'scr' });
scriptSchema.index({ projectId: 1, updatedAt: -1 });

export const Script = mongoose.models.Script ?? mongoose.model('Script', scriptSchema);

