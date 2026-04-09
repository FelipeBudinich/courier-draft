import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const projectSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    slug: {
      type: String,
      trim: true
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    defaultLocale: {
      type: String,
      default: 'en'
    },
    status: {
      type: String,
      default: 'active'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

projectSchema.plugin(publicIdPlugin, { prefix: 'prj' });
projectSchema.index({ ownerId: 1, updatedAt: -1 });

export const Project =
  mongoose.models.Project ?? mongoose.model('Project', projectSchema);

