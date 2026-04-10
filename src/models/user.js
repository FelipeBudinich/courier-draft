import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true
    },
    googleSub: {
      type: String,
      unique: true,
      sparse: true,
      trim: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true
    },
    avatarUrl: {
      type: String,
      default: '',
      trim: true
    },
    locale: {
      type: String,
      default: 'en'
    },
    preferences: {
      locale: {
        type: String,
        default: 'en'
      }
    },
    starterProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null
    },
    lastSeenAt: {
      type: Date,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

userSchema.plugin(publicIdPlugin, { prefix: 'usr' });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
