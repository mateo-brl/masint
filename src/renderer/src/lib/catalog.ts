// Éléments du panneau « Icônes » : types d'entités et plateformes, regroupés par catégorie.

import { CATEGORIES, ENTITY_TYPES, type CategoryId } from '@shared/entityTypes'
import { PLATFORMS } from '@shared/platforms'
import type { I18nText } from '@shared/types'

export interface CatalogItem {
  key: string
  category: CategoryId
  type: string
  platform?: string
  label: I18nText | string
  keywords: string
}

export const CATALOG: CatalogItem[] = [
  ...ENTITY_TYPES.map((t) => ({
    key: `type:${t.id}`,
    category: t.category,
    type: t.id,
    label: t.label,
    keywords: `${t.id} ${t.label.fr} ${t.label.en}`.toLowerCase()
  })),
  ...PLATFORMS.map((p) => ({
    key: `platform:${p.id}`,
    category: p.category,
    type: p.entityType ?? 'account',
    platform: p.id,
    label: p.name,
    keywords: `${p.id} ${p.name} ${p.category}`.toLowerCase()
  }))
]

export const CATALOG_BY_CATEGORY: Record<CategoryId, CatalogItem[]> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, CATALOG.filter((i) => i.category === c.id)])
) as Record<CategoryId, CatalogItem[]>

export const DRAG_MIME = 'application/x-masint-catalog'
