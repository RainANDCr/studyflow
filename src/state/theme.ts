import { useCallback, useEffect, useState } from 'react'

/** 外观偏好：跟随系统 / 浅色 / 深色。仅是界面偏好，存 localStorage，与业务数据无关。 */
export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'studyflow-theme-preference'

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101118' : '#f7f7fb')
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // 存储不可用时仍立即生效，只是不跨会话记忆
  }
  applyTheme(pref)
}

export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference)

  const update = useCallback((p: ThemePreference) => {
    setThemePreference(p)
    setPref(p)
  }, [])

  // 跟随系统时监听系统主题变化
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  return [pref, update]
}
