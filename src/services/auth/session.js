import { env } from '../../config/env.js';

export const attachUserSession = (req, user) => {
  req.session.user = {
    id: String(user._id),
    publicId: user.publicId
  };
};

export const destroyUserSession = (req, res) =>
  new Promise((resolve) => {
    req.session.destroy(() => {
      res.clearCookie(env.sessionName);
      resolve();
    });
  });
