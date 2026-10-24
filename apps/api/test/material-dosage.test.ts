import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MaterialsService } from '../src/materials/materials.service';
import { materialDosage } from '../src/materials/material-dosage';

test('numeric dose has explicit unit and basis; legacy text is not guessed or silently converted', () => {
  const service = new MaterialsService();
  const material = service.create({ name: 'Phân hữu cơ', material_type: 'Fertilizer', unit: 'kg', default_dosage_value: 2.5, dosage_basis: 'cây/lần', quarantine_days: 0 });
  assert.equal(material.default_dosage, '2.5 kg/cây/lần'); assert.equal(material.default_dosage_value, 2.5);
  const before = { ...material };
  assert.throws(() => service.update(material.id, { default_dosage_value: -1 }));
  assert.deepEqual(service.get(material.id), before);
  const updated = service.update(material.id, { dosage_basis: 'cây/đợt' });
  assert.equal(updated.default_dosage_value, 2.5); assert.equal(updated.default_dosage, '2.5 kg/cây/đợt');
  const legacy = service.create({ name: 'Vật tư cũ', material_type: 'Biological', unit: 'g', default_dosage: 'Theo nhãn: không tự đổi sang số', quarantine_days: 0 });
  assert.equal(legacy.default_dosage_value, null);
  assert.throws(() => materialDosage({ default_dosage_value: 1, unit: 'kg' }));
  assert.throws(() => materialDosage({ dosage_basis: 'cây/lần', unit: 'kg' }));
  assert.throws(() => materialDosage({ default_dosage_value: 1.0001, dosage_basis: 'cây/lần', unit: 'kg' }));
  assert.equal(service.get(legacy.id).default_dosage, legacy.default_dosage);
});
