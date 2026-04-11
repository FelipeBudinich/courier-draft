const formatExportDate = ({ date, locale }) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);

export const buildTitlePageModel = ({
  project,
  script,
  locale,
  exportDate,
  selection
}) => ({
  projectTitle: project.name,
  scriptTitle: script.title,
  authors: script.authors ?? [],
  exportDate: exportDate.toISOString(),
  exportDateLabel: formatExportDate({
    date: exportDate,
    locale
  }),
  versionLabel: script.currentVersionLabel ?? 'Draft',
  selectionKind: selection.kind,
  selectionLabel: selection.kind === 'partial' ? 'Selected scenes' : 'Full script'
});

