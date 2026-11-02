import { MailingError, normalizeMailingEmail, type CsvImportPreview } from './Mailing.js';

/** RFC-style quoted fields, including escaped quotes and embedded newlines. */
export function previewContactsCsv(input: string, source: string): CsvImportPreview {
  if (input.length > 500_000) throw new MailingError('csv_too_large', 'Размер CSV не должен превышать 500 КБ');
  if (!source.trim() || source.trim().length > 120) throw new MailingError('source_required', 'Укажите название базы, до 120 символов');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const separators: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') { if (inQuotes && text[i + 1] === '"') i++; else inQuotes = !inQuotes; }
    else if (!inQuotes && char === '\n') break;
    else if (!inQuotes && char in separators) separators[char] = (separators[char] ?? 0) + 1;
  }
  const delimiter = Object.entries(separators).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || !field.trim()) quoted = !quoted;
      else field += char;
    } else if (!quoted && (char === delimiter || char === '\n')) {
      row.push(field.trim()); field = '';
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else field += char;
  }
  if (quoted) throw new MailingError('csv_quotes', 'В CSV не закрыты кавычки');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 5001) throw new MailingError('csv_too_many_rows', 'За один раз можно импортировать до 5000 контактов');
  const header = (rows[0] ?? []).map(s => s.toLowerCase().replace(/[ _-]/g, ''));
  const find = (names: string[]) => header.findIndex(s => names.includes(s));
  const emailIndex = find(['email', 'emailaddress', 'почта', 'электроннаяпочта', 'эл.почта']);
  const hasHeader = emailIndex >= 0;
  const nameIndex = hasHeader ? find(['name', 'имя', 'фио', 'контакт']) : 1;
  const companyIndex = hasHeader ? find(['company', 'companyname', 'компания', 'организация']) : 2;
  const result: CsvImportPreview = { contacts: [], invalid: [], duplicates: 0, total: Math.max(0, rows.length - Number(hasHeader)) };
  const seen = new Set<string>();
  rows.slice(Number(hasHeader)).forEach((cells, index) => {
    const email = normalizeMailingEmail(cells[hasHeader ? emailIndex : 0] ?? '');
    if (!email) { result.invalid.push({ row: index + 1 + Number(hasHeader), message: 'Некорректный email' }); return; }
    if (seen.has(email)) { result.duplicates++; return; }
    seen.add(email);
    result.contacts.push({ email, name: (cells[nameIndex] ?? '').slice(0, 160), company: (cells[companyIndex] ?? '').slice(0, 200), source: source.trim() });
  });
  return result;
}
