import { expect, test } from '@playwright/test'
import { isDuplicateModelImport } from '../src/data/modelLibraryTypes'

const existing = [{
  projectId: 'project-one',
  filename: 'model.glb',
  format: 'glb' as const,
  sizeBytes: 1024,
}]

test('GLB 可按项目、名称和大小去重', () => {
  expect(isDuplicateModelImport(existing, {
    projectId: 'project-one',
    filename: 'model.glb',
    format: 'glb',
    sizeBytes: 1024,
  })).toBe(true)
})

test('OBJ/FBX 不按源文件名称和大小去重，以允许 companion 更新', () => {
  const converted = [
    {
      projectId: 'project-one',
      filename: 'model.obj',
      format: 'obj' as const,
      sizeBytes: 1024,
    },
    {
      projectId: 'project-one',
      filename: 'model.fbx',
      format: 'fbx' as const,
      sizeBytes: 2048,
    },
  ]
  expect(isDuplicateModelImport(converted, converted[0])).toBe(false)
  expect(isDuplicateModelImport(converted, converted[1])).toBe(false)
})
