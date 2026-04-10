import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const outlineNodeSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    scriptId: {
      type: Schema.Types.ObjectId,
      ref: 'Script',
      required: true,
      index: true
    },
    placementParentId: {
      type: Schema.Types.ObjectId,
      ref: 'OutlineNode',
      default: null
    },
    positionKey: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['act', 'beat', 'scene'],
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    sceneId: {
      type: Schema.Types.ObjectId,
      ref: 'Scene'
    },
    actId: {
      type: Schema.Types.ObjectId,
      ref: 'OutlineNode'
    },
    beatId: {
      type: Schema.Types.ObjectId,
      ref: 'OutlineNode'
    },
    autoSceneNumber: {
      type: String
    },
    manualSceneNumber: {
      type: String
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

outlineNodeSchema.plugin(publicIdPlugin, { prefix: 'out' });
outlineNodeSchema.index({ scriptId: 1, placementParentId: 1, positionKey: 1 });
outlineNodeSchema.index({ scriptId: 1, type: 1 });
outlineNodeSchema.index(
  { sceneId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sceneId: {
        $type: 'objectId'
      }
    }
  }
);
outlineNodeSchema.index(
  { scriptId: 1, manualSceneNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      manualSceneNumber: {
        $type: 'string'
      }
    }
  }
);
outlineNodeSchema.index({ scriptId: 1, actId: 1 });
outlineNodeSchema.index({ scriptId: 1, beatId: 1 });

export const OutlineNode =
  mongoose.models.OutlineNode ?? mongoose.model('OutlineNode', outlineNodeSchema);
