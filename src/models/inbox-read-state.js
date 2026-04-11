import mongoose from 'mongoose';

const { Schema } = mongoose;

const inboxReadStateSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    lastReadAllAt: {
      type: Date,
      default: null
    },
    readItemIds: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const InboxReadState =
  mongoose.models.InboxReadState ??
  mongoose.model('InboxReadState', inboxReadStateSchema);
