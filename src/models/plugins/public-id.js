import { randomUUID } from 'node:crypto';

export const generatePublicId = (prefix) =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export const publicIdPlugin = (schema, { prefix }) => {
  schema.add({
    publicId: {
      type: String,
      required: true,
      unique: true,
      index: true
    }
  });

  schema.pre('validate', function assignPublicId(next) {
    if (!this.publicId) {
      this.publicId = generatePublicId(prefix);
    }

    next();
  });
};

