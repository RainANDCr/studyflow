import { copyFileSync } from 'node:fs'

const source = new URL('../src-tauri/android/MainActivity.kt', import.meta.url)
const target = new URL('../src-tauri/gen/android/app/src/main/java/app/studyflow/zxing/MainActivity.kt', import.meta.url)
copyFileSync(source, target)
