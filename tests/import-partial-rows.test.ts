import { describe, expect, it } from 'vitest';
import { detectMapping } from '@/lib/import-mapper';
import { validateImportRow } from '@/lib/import-row-validation';
import { prepareImportRows } from '@/lib/import-spreadsheet';

describe('partial student spreadsheet rows', () => {
  it('drops only fully empty rows and keeps available values in partial rows', () => {
    const prepared = prepareImportRows([
      { الاسم: 'سالم', هويه: '1006598743', ميلاد: '2020-01-01' },
      { الاسم: 'كريم', هويه: '2569874123', ميلاد: '' },
      { الاسم: null, هويه: null, ميلاد: '   ' },
    ], ['الاسم', 'هويه', 'ميلاد']);

    expect(prepared.rows).toEqual([
      { الاسم: 'سالم', هويه: '1006598743', ميلاد: '2020-01-01' },
      { الاسم: 'كريم', هويه: '2569874123', ميلاد: null },
    ]);
    expect(prepared.headers).toEqual(['الاسم', 'هويه', 'ميلاد']);
  });

  it('recognizes the headers used by the supplied workbook', () => {
    const mapping = detectMapping([
      'الاسم',
      'العمر',
      'اسم ولي الامر',
      'اسم ولي الامر 2',
      ' جوال 1',
      'هويه',
      'ميلاد',
      'جوال 2',
    ], 'students');
    const byHeader = Object.fromEntries(mapping.map((entry) => [entry.uploadedColumn, entry.mappedField]));

    expect(byHeader).toMatchObject({
      الاسم: 'full_name',
      'اسم ولي الامر': 'guardian_name',
      'اسم ولي الامر 2': 'guardian_name_2',
      ' جوال 1': 'guardian_phone_1',
      هويه: 'id_number',
      ميلاد: 'date_of_birth',
      'جوال 2': 'guardian_phone_3',
    });
    expect(byHeader.العمر).toBeNull();
  });

  it('accepts a named student when optional cells are blank', () => {
    const result = validateImportRow({
      rawData: { الاسم: 'كريم', هويه: '2569874123', ميلاد: null, 'جوال 2': null },
      mappedData: null,
      errors: null,
      warnings: null,
    }, [
      { uploadedColumn: 'الاسم', mappedField: 'full_name' },
      { uploadedColumn: 'هويه', mappedField: 'id_number' },
      { uploadedColumn: 'ميلاد', mappedField: 'date_of_birth' },
      { uploadedColumn: 'جوال 2', mappedField: 'guardian_phone_3' },
    ], 'students');

    expect(result.errors).toEqual([]);
    expect(result.mappedData).toMatchObject({ full_name: 'كريم', id_number: '2569874123' });
    expect(result.mappedData.date_of_birth).toBeNull();
    expect(result.mappedData.guardian_phone_3).toBeNull();
  });
});
