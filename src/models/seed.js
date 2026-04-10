import {
  ActivityEvent,
  AuditLog,
  DocumentVersion,
  Note,
  OutlineNode,
  Project,
  ProjectMember,
  Scene,
  Script,
  User
} from './index.js';

export const seedFixtures = {
  users: {
    owner: {
      publicId: 'usr_owner_demo',
      email: 'owner@courier.test',
      username: 'ownerdemo',
      displayName: 'Olivia Owner',
      locale: 'en'
    },
    editor: {
      publicId: 'usr_editor_demo',
      email: 'editor@courier.test',
      username: 'editordemo',
      displayName: 'Eddie Editor',
      locale: 'es'
    },
    reviewer: {
      publicId: 'usr_reviewer_demo',
      email: 'reviewer@courier.test',
      username: 'reviewerdemo',
      displayName: 'Rina Reviewer',
      locale: 'ja'
    }
  },
  project: {
    publicId: 'prj_foundation_demo',
    name: 'Courier Pilot',
    description: 'Seeded project for platform foundation development.'
  },
  members: {
    owner: 'pmm_owner_demo',
    editor: 'pmm_editor_demo',
    reviewer: 'pmm_reviewer_demo'
  },
  script: {
    publicId: 'scr_pilot_demo',
    title: 'Pilot Episode'
  },
  scenes: {
    intro: {
      publicId: 'scn_intro_demo',
      title: 'INT. WRITERS ROOM - DAY'
    }
  },
  notes: {
    reviewer: {
      publicId: 'nte_reviewer_demo'
    },
    owner: {
      publicId: 'nte_owner_demo'
    }
  }
};

export const seedDevelopmentData = async () => {
  const owner = await User.findOneAndUpdate(
    { email: seedFixtures.users.owner.email },
    {
      $set: {
        publicId: seedFixtures.users.owner.publicId,
        email: seedFixtures.users.owner.email,
        username: seedFixtures.users.owner.username,
        displayName: seedFixtures.users.owner.displayName,
        avatarUrl: '',
        locale: seedFixtures.users.owner.locale,
        preferences: { locale: seedFixtures.users.owner.locale },
        lastSeenAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const editor = await User.findOneAndUpdate(
    { email: seedFixtures.users.editor.email },
    {
      $set: {
        publicId: seedFixtures.users.editor.publicId,
        email: seedFixtures.users.editor.email,
        username: seedFixtures.users.editor.username,
        displayName: seedFixtures.users.editor.displayName,
        avatarUrl: '',
        locale: seedFixtures.users.editor.locale,
        preferences: { locale: seedFixtures.users.editor.locale },
        lastSeenAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const reviewer = await User.findOneAndUpdate(
    { email: seedFixtures.users.reviewer.email },
    {
      $set: {
        publicId: seedFixtures.users.reviewer.publicId,
        email: seedFixtures.users.reviewer.email,
        username: seedFixtures.users.reviewer.username,
        displayName: seedFixtures.users.reviewer.displayName,
        avatarUrl: '',
        locale: seedFixtures.users.reviewer.locale,
        preferences: { locale: seedFixtures.users.reviewer.locale },
        lastSeenAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const project = await Project.findOneAndUpdate(
    { publicId: seedFixtures.project.publicId },
    {
      $set: {
        publicId: seedFixtures.project.publicId,
        name: seedFixtures.project.name,
        description: seedFixtures.project.description,
        ownerId: owner._id,
        defaultLocale: 'en',
        status: 'active'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Promise.all([
    ProjectMember.findOneAndUpdate(
      { publicId: seedFixtures.members.owner },
      {
        $set: {
          publicId: seedFixtures.members.owner,
          projectId: project._id,
          userId: owner._id,
          role: 'owner',
          status: 'active',
          invitedById: owner._id,
          invitedAt: new Date(),
          acceptedAt: new Date(),
          joinedAt: new Date(),
          removedAt: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    ProjectMember.findOneAndUpdate(
      { publicId: seedFixtures.members.editor },
      {
        $set: {
          publicId: seedFixtures.members.editor,
          projectId: project._id,
          userId: editor._id,
          role: 'editor',
          status: 'active',
          invitedById: owner._id,
          invitedAt: new Date(),
          acceptedAt: new Date(),
          joinedAt: new Date(),
          removedAt: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    ProjectMember.findOneAndUpdate(
      { publicId: seedFixtures.members.reviewer },
      {
        $set: {
          publicId: seedFixtures.members.reviewer,
          projectId: project._id,
          userId: reviewer._id,
          role: 'reviewer',
          status: 'active',
          invitedById: owner._id,
          invitedAt: new Date(),
          acceptedAt: new Date(),
          joinedAt: new Date(),
          removedAt: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  const script = await Script.findOneAndUpdate(
    { publicId: seedFixtures.script.publicId },
    {
      $set: {
        publicId: seedFixtures.script.publicId,
        projectId: project._id,
        title: seedFixtures.script.title,
        description: 'Seeded script for outline and editor-shell development.',
        genre: 'Drama',
        slug: 'pilot-episode',
        status: 'draft',
        language: 'en',
        authors: ['Olivia Owner', 'Eddie Editor'],
        majorSaveSequence: 0,
        currentVersionLabel: null,
        sceneNumberMode: 'auto',
        createdByUserId: owner._id,
        updatedByUserId: owner._id
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const scene = await Scene.findOneAndUpdate(
    { publicId: seedFixtures.scenes.intro.publicId },
    {
      $set: {
        publicId: seedFixtures.scenes.intro.publicId,
        projectId: project._id,
        scriptId: script._id,
        title: seedFixtures.scenes.intro.title,
        structuredBody: {
          blocks: [],
          cachedSlugline: null,
          characterRefs: [],
          locationRefs: []
        },
        headContent: 'A team of writers gathers around a whiteboard.',
        headUpdatedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const outlineNode = await OutlineNode.findOneAndUpdate(
    { publicId: 'out_intro_scene_demo' },
    {
      $set: {
        publicId: 'out_intro_scene_demo',
        projectId: project._id,
        scriptId: script._id,
        placementParentId: null,
        positionKey: 'a1',
        type: 'scene',
        title: seedFixtures.scenes.intro.title,
        sceneId: scene._id,
        autoSceneNumber: '1'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Scene.updateOne(
    { _id: scene._id },
    {
      $set: {
        outlineNodeId: outlineNode._id
      }
    }
  );

  const note = await Note.findOneAndUpdate(
    { publicId: seedFixtures.notes.reviewer.publicId },
    {
      $set: {
        publicId: seedFixtures.notes.reviewer.publicId,
        projectId: project._id,
        scriptId: script._id,
        sceneId: scene._id,
        authorId: reviewer._id,
        containerType: 'scene',
        containerId: scene._id,
        body: 'Flag the visual motif here for the next draft.',
        headUpdatedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Note.findOneAndUpdate(
    { publicId: seedFixtures.notes.owner.publicId },
    {
      $set: {
        publicId: seedFixtures.notes.owner.publicId,
        projectId: project._id,
        scriptId: script._id,
        sceneId: scene._id,
        authorId: owner._id,
        containerType: 'scene',
        containerId: scene._id,
        body: 'Owner note for permission checks.',
        headUpdatedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const sceneVersion = await DocumentVersion.findOneAndUpdate(
    { publicId: 'ver_scene_intro_demo' },
    {
      $set: {
        publicId: 'ver_scene_intro_demo',
        projectId: project._id,
        docType: 'scene',
        docId: scene._id,
        versionLabel: '1.0.0',
        content: scene.headContent,
        savedAt: new Date(),
        createdById: owner._id,
        isMajor: true
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const noteVersion = await DocumentVersion.findOneAndUpdate(
    { publicId: 'ver_note_reviewer_demo' },
    {
      $set: {
        publicId: 'ver_note_reviewer_demo',
        projectId: project._id,
        docType: 'note',
        docId: note._id,
        versionLabel: '1.0.0',
        content: note.body,
        savedAt: new Date(),
        createdById: reviewer._id,
        isMajor: true
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Promise.all([
    Scene.updateOne(
      { _id: scene._id },
      { $set: { latestMajorVersionId: sceneVersion._id } }
    ),
    Note.updateOne(
      { _id: note._id },
      { $set: { latestMajorVersionId: noteVersion._id } }
    )
  ]);

  await Promise.all([
    ActivityEvent.findOneAndUpdate(
      { publicId: 'act_project_seeded_demo' },
      {
        $set: {
          publicId: 'act_project_seeded_demo',
          projectId: project._id,
          actorId: owner._id,
          type: 'project.seeded',
          message: 'Foundation data seeded for local development.',
          payload: {
            scriptId: script.publicId
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    AuditLog.findOneAndUpdate(
      { publicId: 'aud_project_seeded_demo' },
      {
        $set: {
          publicId: 'aud_project_seeded_demo',
          projectId: project._id,
          actorId: owner._id,
          action: 'seed.created',
          targetType: 'project',
          targetId: project.publicId,
          metadata: {
            seededUsers: [
              owner.publicId,
              editor.publicId,
              reviewer.publicId
            ]
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  return {
    owner,
    editor,
    reviewer,
    project,
    script,
    scene,
    note
  };
};
