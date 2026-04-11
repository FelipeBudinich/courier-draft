export const DEFAULT_PROJECT_TITLES = [
  'Iliad',
  'Odyssey',
  'Aeneid',
  'Thebaid',
  'Argonautica',
  'Oresteia',
  'Mahabharata',
  'Ramayana',
  'Shahnameh',
  'Gilgamesh',
  'Kalevala',
  'Sundiata'
];

const normalizeTitle = (value) => String(value ?? '').trim();

export const getNextDefaultProjectTitle = (existingTitles = []) => {
  const occupiedTitles = new Set(existingTitles.map(normalizeTitle).filter(Boolean));

  for (let cycle = 1; ; cycle += 1) {
    for (const title of DEFAULT_PROJECT_TITLES) {
      const candidate = cycle === 1 ? title : `${title} ${cycle}`;
      if (!occupiedTitles.has(candidate)) {
        return candidate;
      }
    }
  }
};
