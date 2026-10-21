import type { MasintBridge } from '@shared/api'

declare global {
  interface Window {
    masint: MasintBridge
  }
}

export {}
