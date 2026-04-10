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
    description: {
      type: String,
      trim: true,
      default: ''
    },
    genre: {
      type: String,
      trim: true,
      default: ''
    },
    slug: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      default: 'draft'
    },
    language: {
      type: String,
      trim: true,
      default: ''
    },
    authors: {
      type: [String],
      default: []
    },
    majorSaveSequence: {
      type: Number,
      default: 0
    },
    currentVersionLabel: {
      type: String,
      trim: true,
      default: null
    },
    sceneNumberMode: {
      type: String,
      enum: ['off', 'auto', 'frozen'],
      default: 'auto'
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedByUserId: {
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
scriptSchema.index({ projectId: 1, title: 1 });

export const Script = mongoose.models.Script ?? mongoose.model('Script', scriptSchema);
