import { connectToMongo, disconnectFromMongo } from '../src/config/db.js';
import { seedDevelopmentData } from '../src/models/seed.js';

const main = async () => {
  await connectToMongo();
  const result = await seedDevelopmentData();

  console.log('Seeded Courier Draft foundation data.');
  console.log(
    JSON.stringify(
      {
        users: [
          result.owner.email,
          result.editor.email,
          result.reviewer.email
        ],
        project: result.project.publicId,
        script: result.script.publicId,
        scene: result.scene.publicId,
        note: result.note.publicId
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromMongo();
  });

