// Traductions du canevas avancé (texte, image, dessin, mini-carte), de la vue Carte et de la frise.

const fr = {
  canvas2: {
    textPlaceholder: 'Double-cliquez pour écrire',
    fontSmaller: 'Réduire le texte',
    fontLarger: 'Agrandir le texte',
    plain: 'Sans fond',
    postit: 'Post-it',
    imageMissing: 'Image introuvable',
    mapUntitled: 'Carte',
    basemap: 'Fond : {{name}}'
  },
  map: {
    kicker: 'Carte',
    located_one: '{{count}} entité localisée',
    located_other: '{{count}} entités localisées',
    search: 'Filtrer…',
    noMatch: 'Aucun résultat',
    showList: 'Afficher la liste',
    hideList: 'Masquer la liste',
    fit: 'Ajuster aux marqueurs',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    cluster_one: '{{count}} entité',
    cluster_other: '{{count}} entités',
    emptyTitle: 'Aucune entité géolocalisée',
    emptyBody:
      'Les entités dont la fiche contient une latitude (lat) et une longitude (lon) apparaissent ici. Les modules de géolocalisation (adresse IP, adresse postale, EXIF d’une photo) les renseignent automatiquement.',
    backToGraph: 'Revenir au graphe',
    basemaps: {
      osm: 'Plan',
      'carto-dark': 'Sombre',
      'carto-light': 'Clair',
      satellite: 'Satellite'
    }
  },
  timeline: {
    kicker: 'Frise chronologique',
    events_one: '{{count}} événement daté',
    events_other: '{{count}} événements datés',
    entities_one: '{{count}} entité',
    entities_other: '{{count}} entités',
    range: 'du {{from}} au {{to}}',
    fit: 'Tout afficher',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    hint: 'Molette pour zoomer, glisser pour se déplacer',
    all: 'Tous',
    today: 'Aujourd’hui',
    list: 'Chronologie',
    onlyVisible: 'Période affichée uniquement',
    more_one: '+{{count}} autre',
    more_other: '+{{count}} autres',
    noneInView: 'Aucun événement sur cette période',
    emptyTitle: 'Aucun événement daté',
    emptyBody:
      'Les dates présentes dans les fiches des entités (création d’un compte, naissance, fuite de données, transaction…) apparaissent ici. Renseignez une date dans une fiche ou lancez des modules d’enrichissement.',
    backToGraph: 'Revenir au graphe'
  }
}

const en: typeof fr = {
  canvas2: {
    textPlaceholder: 'Double-click to write',
    fontSmaller: 'Smaller text',
    fontLarger: 'Larger text',
    plain: 'No background',
    postit: 'Sticky note',
    imageMissing: 'Image not found',
    mapUntitled: 'Map',
    basemap: 'Basemap: {{name}}'
  },
  map: {
    kicker: 'Map',
    located_one: '{{count}} located entity',
    located_other: '{{count}} located entities',
    search: 'Filter…',
    noMatch: 'No result',
    showList: 'Show list',
    hideList: 'Hide list',
    fit: 'Fit to markers',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    cluster_one: '{{count}} entity',
    cluster_other: '{{count}} entities',
    emptyTitle: 'No geolocated entity',
    emptyBody:
      'Entities whose sheet holds a latitude (lat) and a longitude (lon) show up here. Geolocation modules (IP address, postal address, photo EXIF) fill them in automatically.',
    backToGraph: 'Back to graph',
    basemaps: {
      osm: 'Streets',
      'carto-dark': 'Dark',
      'carto-light': 'Light',
      satellite: 'Satellite'
    }
  },
  timeline: {
    kicker: 'Timeline',
    events_one: '{{count}} dated event',
    events_other: '{{count}} dated events',
    entities_one: '{{count}} entity',
    entities_other: '{{count}} entities',
    range: 'from {{from}} to {{to}}',
    fit: 'Show all',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    hint: 'Scroll to zoom, drag to move',
    all: 'All',
    today: 'Today',
    list: 'Chronology',
    onlyVisible: 'Visible period only',
    more_one: '+{{count}} more',
    more_other: '+{{count}} more',
    noneInView: 'No event in this period',
    emptyTitle: 'No dated event',
    emptyBody:
      'Dates found in entity sheets (account creation, birth, data breach, transaction…) show up here. Fill in a date in a sheet or run enrichment modules.',
    backToGraph: 'Back to graph'
  }
}

export default { fr, en }
