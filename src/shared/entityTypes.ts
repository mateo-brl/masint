// Catalogue des types d'entités. Chaque type a une icône Lucide, une couleur
// et la liste des champs proposés dans la fiche.

import type { I18nText } from './types'

export type CategoryId =
  | 'identity'
  | 'web'
  | 'location'
  | 'finance'
  | 'forensic'
  | 'groups'
  | 'hardware'
  | 'hlr'
  | 'carrier'
  | 'email'
  | 'social'
  | 'messaging'
  | 'crypto'
  | 'hosting'

export interface CategoryDef {
  id: CategoryId
  label: I18nText
  icon: string
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'identity', label: { fr: 'Identité', en: 'Identity' }, icon: 'IdCard' },
  { id: 'web', label: { fr: 'Internet / Web', en: 'Internet / Web' }, icon: 'Globe' },
  { id: 'location', label: { fr: 'Localisation', en: 'Location' }, icon: 'MapPin' },
  { id: 'finance', label: { fr: 'Finance / Business', en: 'Finance / Business' }, icon: 'Landmark' },
  { id: 'forensic', label: { fr: 'Forensic / IOC', en: 'Forensic / IOC' }, icon: 'ShieldAlert' },
  { id: 'groups', label: { fr: 'Groupes / orgs', en: 'Groups / orgs' }, icon: 'Users' },
  { id: 'hardware', label: { fr: 'Matériel / divers', en: 'Hardware / misc' }, icon: 'Cpu' },
  { id: 'hlr', label: { fr: 'Statut HLR', en: 'HLR status' }, icon: 'PhoneCall' },
  { id: 'carrier', label: { fr: 'Opérateur téléphonique', en: 'Phone carrier' }, icon: 'RadioTower' },
  { id: 'email', label: { fr: 'Email', en: 'Email' }, icon: 'Mail' },
  { id: 'social', label: { fr: 'Réseaux sociaux', en: 'Social networks' }, icon: 'Share2' },
  { id: 'messaging', label: { fr: 'Messagerie', en: 'Messaging' }, icon: 'MessageCircle' },
  { id: 'crypto', label: { fr: 'Crypto', en: 'Crypto' }, icon: 'Bitcoin' },
  { id: 'hosting', label: { fr: 'Hébergeur', en: 'Hosting' }, icon: 'Server' }
]

export type FieldKind = 'text' | 'textarea' | 'url' | 'date' | 'number' | 'list' | 'email' | 'phone'

export interface FieldDef {
  key: string
  label: I18nText
  kind?: FieldKind
}

export interface EntityTypeDef {
  id: string
  category: CategoryId
  label: I18nText
  icon: string
  color: string
  fields: FieldDef[]
  /** Exemple affiché dans le champ libellé. */
  placeholder?: string
  /** Les nœuds de ce type portent une plateforme (compte, opérateur...). */
  usesPlatform?: boolean
}

const f = (key: string, fr: string, en: string, kind?: FieldKind): FieldDef => ({
  key,
  label: { fr, en },
  kind
})

const COMMON_ACCOUNT_FIELDS: FieldDef[] = [
  f('username', 'Identifiant', 'Username'),
  f('display_name', 'Nom affiché', 'Display name'),
  f('user_id', 'ID utilisateur', 'User ID'),
  f('url', 'URL du profil', 'Profile URL', 'url'),
  f('bio', 'Bio', 'Bio', 'textarea'),
  f('location', 'Localisation', 'Location'),
  f('followers', 'Abonnés', 'Followers', 'number'),
  f('following', 'Abonnements', 'Following', 'number'),
  f('created_at', 'Date de création', 'Created at', 'date'),
  f('last_seen', 'Dernière activité', 'Last seen', 'date'),
  f('linked_logins', 'Connexions liées', 'Linked logins', 'list'),
  f('login_methods', 'Moyens de connexion', 'Login methods', 'list'),
  f('recovery_emails', 'Emails de récupération', 'Recovery emails', 'list'),
  f('recovery_phones', 'Téléphones de récupération', 'Recovery phones', 'list'),
  f('recovery_hints', 'Indices de récupération', 'Recovery hints', 'list')
]

export const ENTITY_TYPES: EntityTypeDef[] = [
  // Identité
  {
    id: 'person',
    category: 'identity',
    label: { fr: 'Nom et prénom', en: 'Full name' },
    icon: 'User',
    color: '#60a5fa',
    placeholder: 'Jean Dupont',
    fields: [
      f('first_name', 'Prénom', 'First name'),
      f('last_name', 'Nom', 'Last name'),
      f('birth_date', 'Date de naissance', 'Birth date', 'date'),
      f('birth_place', 'Lieu de naissance', 'Birth place'),
      f('gender', 'Genre', 'Gender'),
      f('nationality', 'Nationalité', 'Nationality'),
      f('occupation', 'Profession', 'Occupation'),
      f('aliases', 'Alias', 'Aliases', 'list')
    ]
  },
  {
    id: 'username',
    category: 'identity',
    label: { fr: 'Pseudo', en: 'Username' },
    icon: 'AtSign',
    color: '#a78bfa',
    placeholder: 'john_doe',
    fields: []
  },
  {
    id: 'phone',
    category: 'identity',
    label: { fr: 'Téléphone', en: 'Phone number' },
    icon: 'Phone',
    color: '#c084fc',
    placeholder: '+33612345678',
    fields: [
      f('e164', 'Format E.164', 'E.164 format'),
      f('national', 'Format national', 'National format'),
      f('country', 'Pays', 'Country'),
      f('line_type', 'Type de ligne', 'Line type'),
      f('carrier', 'Opérateur', 'Carrier'),
      f('region', 'Zone', 'Region'),
      f('timezones', 'Fuseaux horaires', 'Timezones', 'list'),
      f('hlr_status', 'Statut HLR', 'HLR status'),
      f('current_carrier', 'Opérateur actuel', 'Current carrier'),
      f('ported', 'Porté', 'Ported'),
      f('roaming', 'Itinérance', 'Roaming'),
      f('mccmnc', 'MCC/MNC', 'MCC/MNC'),
      f('formats', 'Autres formats', 'Other formats', 'list')
    ]
  },
  {
    id: 'account',
    category: 'identity',
    label: { fr: 'Compte en ligne', en: 'Online account' },
    icon: 'CircleUser',
    color: '#6366f1',
    usesPlatform: true,
    fields: COMMON_ACCOUNT_FIELDS
  },
  {
    id: 'id_document',
    category: 'identity',
    label: { fr: "Pièce d'identité", en: 'ID document' },
    icon: 'IdCard',
    color: '#94a3b8',
    fields: [
      f('number', 'Numéro', 'Number'),
      f('country', 'Pays', 'Country'),
      f('issue_date', "Date d'émission", 'Issue date', 'date'),
      f('expiry_date', "Date d'expiration", 'Expiry date', 'date')
    ]
  },
  {
    id: 'photo',
    category: 'identity',
    label: { fr: 'Photo', en: 'Photo' },
    icon: 'Image',
    color: '#f472b6',
    fields: [
      f('taken_at', 'Prise le', 'Taken at', 'date'),
      f('camera', 'Appareil', 'Camera'),
      f('lat', 'Latitude', 'Latitude', 'number'),
      f('lon', 'Longitude', 'Longitude', 'number'),
      f('url', 'URL', 'URL', 'url')
    ]
  },

  // Internet / Web
  {
    id: 'domain',
    category: 'web',
    label: { fr: 'Domaine', en: 'Domain' },
    icon: 'Globe',
    color: '#22d3ee',
    placeholder: 'example.com',
    fields: [
      f('registrar', 'Registrar', 'Registrar'),
      f('created_at', 'Créé le', 'Created at', 'date'),
      f('expires_at', 'Expire le', 'Expires at', 'date'),
      f('updated_at', 'Mis à jour le', 'Updated at', 'date'),
      f('nameservers', 'Serveurs DNS', 'Nameservers', 'list'),
      f('status', 'Statut', 'Status', 'list')
    ]
  },
  {
    id: 'url',
    category: 'web',
    label: { fr: 'URL', en: 'URL' },
    icon: 'Link',
    color: '#38bdf8',
    placeholder: 'https://example.com/page',
    fields: [f('title', 'Titre', 'Title'), f('status_code', 'Code HTTP', 'HTTP status', 'number')]
  },
  {
    id: 'website',
    category: 'web',
    label: { fr: 'Site web', en: 'Website' },
    icon: 'AppWindow',
    color: '#0ea5e9',
    placeholder: 'https://example.com',
    fields: [
      f('title', 'Titre', 'Title'),
      f('description', 'Description', 'Description', 'textarea'),
      f('server', 'Serveur', 'Server'),
      f('technologies', 'Technologies', 'Technologies', 'list')
    ]
  },
  {
    id: 'ip',
    category: 'web',
    label: { fr: 'Adresse IP', en: 'IP address' },
    icon: 'Network',
    color: '#2dd4bf',
    placeholder: '8.8.8.8',
    fields: [
      f('version', 'Version', 'Version'),
      f('country', 'Pays', 'Country'),
      f('city', 'Ville', 'City'),
      f('isp', 'FAI', 'ISP'),
      f('org', 'Organisation', 'Organization'),
      f('asn', 'ASN', 'ASN'),
      f('reverse', 'Reverse DNS', 'Reverse DNS'),
      f('ports', 'Ports ouverts', 'Open ports', 'list'),
      f('lat', 'Latitude', 'Latitude', 'number'),
      f('lon', 'Longitude', 'Longitude', 'number')
    ]
  },
  {
    id: 'asn',
    category: 'web',
    label: { fr: 'ASN', en: 'ASN' },
    icon: 'Waypoints',
    color: '#14b8a6',
    placeholder: 'AS15169',
    fields: [f('name', 'Nom', 'Name'), f('country', 'Pays', 'Country'), f('registry', 'Registre', 'Registry')]
  },
  {
    id: 'cidr',
    category: 'web',
    label: { fr: 'Plage IP (CIDR)', en: 'IP range (CIDR)' },
    icon: 'Boxes',
    color: '#0d9488',
    placeholder: '8.8.8.0/24',
    fields: []
  },
  {
    id: 'certificate',
    category: 'web',
    label: { fr: 'Certificat TLS', en: 'TLS certificate' },
    icon: 'FileLock',
    color: '#5eead4',
    fields: [
      f('issuer', 'Émetteur', 'Issuer'),
      f('not_before', 'Valide depuis', 'Not before', 'date'),
      f('not_after', "Valide jusqu'au", 'Not after', 'date'),
      f('serial', 'Numéro de série', 'Serial'),
      f('sha256', 'Empreinte SHA-256', 'SHA-256 fingerprint'),
      f('dns_names', 'Noms couverts', 'Covered names', 'list')
    ]
  },
  {
    id: 'tracker',
    category: 'web',
    label: { fr: 'Traceur / ID analytics', en: 'Tracker / analytics ID' },
    icon: 'Radar',
    color: '#67e8f9',
    placeholder: 'G-XXXXXXX',
    fields: [f('kind', 'Type', 'Kind')]
  },
  {
    id: 'technology',
    category: 'web',
    label: { fr: 'Technologie', en: 'Technology' },
    icon: 'Layers',
    color: '#7dd3fc',
    fields: [f('version', 'Version', 'Version')]
  },
  {
    id: 'service',
    category: 'web',
    label: { fr: 'Service / port', en: 'Service / port' },
    icon: 'Plug',
    color: '#99f6e4',
    placeholder: '443/https',
    fields: [
      f('port', 'Port', 'Port', 'number'),
      f('product', 'Produit', 'Product'),
      f('title', 'Titre', 'Title'),
      f('banner', 'Bannière', 'Banner', 'textarea')
    ]
  },

  // Localisation
  {
    id: 'address',
    category: 'location',
    label: { fr: 'Adresse', en: 'Address' },
    icon: 'House',
    color: '#facc15',
    placeholder: '10 rue de Rivoli, Paris',
    fields: [
      f('street', 'Rue', 'Street'),
      f('postcode', 'Code postal', 'Postcode'),
      f('city', 'Ville', 'City'),
      f('country', 'Pays', 'Country'),
      f('lat', 'Latitude', 'Latitude', 'number'),
      f('lon', 'Longitude', 'Longitude', 'number')
    ]
  },
  {
    id: 'city',
    category: 'location',
    label: { fr: 'Ville', en: 'City' },
    icon: 'BuildingComplex',
    color: '#fde047',
    fields: [f('country', 'Pays', 'Country'), f('lat', 'Latitude', 'Latitude', 'number'), f('lon', 'Longitude', 'Longitude', 'number')]
  },
  {
    id: 'country',
    category: 'location',
    label: { fr: 'Pays', en: 'Country' },
    icon: 'Flag',
    color: '#eab308',
    fields: [f('code', 'Code ISO', 'ISO code')]
  },
  {
    id: 'coordinates',
    category: 'location',
    label: { fr: 'Coordonnées GPS', en: 'GPS coordinates' },
    icon: 'LocateFixed',
    color: '#fbbf24',
    placeholder: '48.8566, 2.3522',
    fields: [f('lat', 'Latitude', 'Latitude', 'number'), f('lon', 'Longitude', 'Longitude', 'number'), f('accuracy', 'Précision (m)', 'Accuracy (m)', 'number')]
  },
  {
    id: 'place',
    category: 'location',
    label: { fr: 'Lieu', en: 'Place' },
    icon: 'MapPin',
    color: '#f59e0b',
    fields: [f('kind', 'Type de lieu', 'Kind'), f('lat', 'Latitude', 'Latitude', 'number'), f('lon', 'Longitude', 'Longitude', 'number')]
  },

  // Finance / Business
  {
    id: 'company',
    category: 'finance',
    label: { fr: 'Entreprise', en: 'Company' },
    icon: 'Building',
    color: '#4ade80',
    fields: [
      f('siren', 'SIREN', 'SIREN'),
      f('siret', 'SIRET', 'SIRET'),
      f('legal_form', 'Forme juridique', 'Legal form'),
      f('activity', 'Activité', 'Activity'),
      f('created_at', 'Créée le', 'Created at', 'date'),
      f('closed_at', 'Fermée le', 'Closed at', 'date'),
      f('address', 'Adresse', 'Address'),
      f('employees', 'Effectif', 'Employees')
    ]
  },
  {
    id: 'iban',
    category: 'finance',
    label: { fr: 'IBAN', en: 'IBAN' },
    icon: 'CreditCard',
    color: '#22c55e',
    placeholder: 'FR7630006000011234567890189',
    fields: [f('bic', 'BIC', 'BIC'), f('bank', 'Banque', 'Bank'), f('country', 'Pays', 'Country'), f('valid', 'Valide', 'Valid')]
  },
  {
    id: 'bank',
    category: 'finance',
    label: { fr: 'Banque', en: 'Bank' },
    icon: 'Landmark',
    color: '#16a34a',
    fields: [f('bic', 'BIC', 'BIC'), f('city', 'Ville', 'City')]
  },
  {
    id: 'vat',
    category: 'finance',
    label: { fr: 'Numéro de TVA', en: 'VAT number' },
    icon: 'Receipt',
    color: '#86efac',
    fields: []
  },

  // Forensic / IOC
  {
    id: 'hash',
    category: 'forensic',
    label: { fr: 'Empreinte (hash)', en: 'Hash' },
    icon: 'Hash',
    color: '#f87171',
    fields: [f('algorithm', 'Algorithme', 'Algorithm')]
  },
  {
    id: 'breach',
    category: 'forensic',
    label: { fr: 'Fuite de données', en: 'Data breach' },
    icon: 'DatabaseZap',
    color: '#ef4444',
    fields: [
      f('breach_date', 'Date de la fuite', 'Breach date', 'date'),
      f('records', 'Enregistrements', 'Records', 'number'),
      f('data_classes', 'Données exposées', 'Exposed data', 'list'),
      f('description', 'Description', 'Description', 'textarea')
    ]
  },
  {
    id: 'infostealer',
    category: 'forensic',
    label: { fr: 'Infection infostealer', en: 'Infostealer infection' },
    icon: 'Bug',
    color: '#dc2626',
    fields: [
      f('date_compromised', 'Date de compromission', 'Compromised at', 'date'),
      f('computer_name', 'Nom du poste', 'Computer name'),
      f('os', 'Système', 'OS'),
      f('malware_path', 'Chemin du malware', 'Malware path'),
      f('antiviruses', 'Antivirus', 'Antiviruses', 'list'),
      f('ip', 'IP', 'IP')
    ]
  },
  {
    id: 'password',
    category: 'forensic',
    label: { fr: 'Mot de passe (fuite)', en: 'Leaked password' },
    icon: 'KeyRound',
    color: '#fb7185',
    fields: []
  },
  {
    id: 'malware',
    category: 'forensic',
    label: { fr: 'Malware', en: 'Malware' },
    icon: 'Biohazard',
    color: '#b91c1c',
    fields: [f('family', 'Famille', 'Family')]
  },
  {
    id: 'cve',
    category: 'forensic',
    label: { fr: 'Vulnérabilité (CVE)', en: 'Vulnerability (CVE)' },
    icon: 'ShieldAlert',
    color: '#f43f5e',
    placeholder: 'CVE-2024-3400',
    fields: [f('cvss', 'Score CVSS', 'CVSS score', 'number'), f('summary', 'Résumé', 'Summary', 'textarea')]
  },
  {
    id: 'file',
    category: 'forensic',
    label: { fr: 'Fichier', en: 'File' },
    icon: 'File',
    color: '#fda4af',
    fields: [f('size', 'Taille', 'Size', 'number'), f('mime', 'Type MIME', 'MIME type'), f('sha256', 'SHA-256', 'SHA-256')]
  },
  {
    id: 'user_agent',
    category: 'forensic',
    label: { fr: 'User-Agent', en: 'User-Agent' },
    icon: 'Monitor',
    color: '#fecdd3',
    fields: []
  },

  // Groupes / orgs
  {
    id: 'organization',
    category: 'groups',
    label: { fr: 'Organisation', en: 'Organization' },
    icon: 'BuildingComplex',
    color: '#fb923c',
    fields: [f('kind', 'Type', 'Kind'), f('country', 'Pays', 'Country'), f('website', 'Site web', 'Website', 'url')]
  },
  {
    id: 'group',
    category: 'groups',
    label: { fr: 'Groupe / communauté', en: 'Group / community' },
    icon: 'Users',
    color: '#f97316',
    fields: [f('members', 'Membres', 'Members', 'number'), f('url', 'URL', 'URL', 'url')]
  },
  {
    id: 'school',
    category: 'groups',
    label: { fr: 'Établissement scolaire', en: 'School' },
    icon: 'GraduationCap',
    color: '#fdba74',
    fields: []
  },
  {
    id: 'administration',
    category: 'groups',
    label: { fr: 'Administration', en: 'Government body' },
    icon: 'Landmark',
    color: '#ea580c',
    fields: []
  },

  // Matériel / divers
  {
    id: 'device',
    category: 'hardware',
    label: { fr: 'Appareil', en: 'Device' },
    icon: 'Smartphone',
    color: '#a3a3a3',
    fields: [f('model', 'Modèle', 'Model'), f('os', 'Système', 'OS'), f('imei', 'IMEI', 'IMEI')]
  },
  {
    id: 'vehicle',
    category: 'hardware',
    label: { fr: 'Véhicule', en: 'Vehicle' },
    icon: 'Car',
    color: '#d4d4d4',
    fields: [f('plate', 'Immatriculation', 'Plate'), f('brand', 'Marque', 'Brand'), f('model', 'Modèle', 'Model'), f('color', 'Couleur', 'Color')]
  },
  {
    id: 'license_plate',
    category: 'hardware',
    label: { fr: 'Plaque', en: 'License plate' },
    icon: 'RectangleHorizontal',
    color: '#e5e5e5',
    placeholder: 'AB-123-CD',
    fields: [f('country', 'Pays', 'Country')]
  },
  {
    id: 'mac_address',
    category: 'hardware',
    label: { fr: 'Adresse MAC', en: 'MAC address' },
    icon: 'Router',
    color: '#737373',
    fields: [f('vendor', 'Constructeur', 'Vendor')]
  },
  {
    id: 'document',
    category: 'hardware',
    label: { fr: 'Document', en: 'Document' },
    icon: 'FileText',
    color: '#cbd5e1',
    fields: [f('url', 'URL', 'URL', 'url'), f('author', 'Auteur', 'Author'), f('created_at', 'Créé le', 'Created at', 'date')]
  },
  {
    id: 'event',
    category: 'hardware',
    label: { fr: 'Événement', en: 'Event' },
    icon: 'CalendarDays',
    color: '#e2e8f0',
    fields: [f('date', 'Date', 'Date', 'date'), f('end_date', 'Fin', 'End', 'date'), f('place', 'Lieu', 'Place')]
  },
  {
    id: 'keyword',
    category: 'hardware',
    label: { fr: 'Mot-clé', en: 'Keyword' },
    icon: 'Tag',
    color: '#9ca3af',
    fields: []
  },
  {
    id: 'search_link',
    category: 'hardware',
    label: { fr: 'Lien de recherche', en: 'Search link' },
    icon: 'Search',
    color: '#6b7280',
    fields: [f('url', 'URL', 'URL', 'url'), f('engine', 'Moteur', 'Engine')]
  },

  // Statut HLR
  {
    id: 'hlr',
    category: 'hlr',
    label: { fr: 'Statut HLR', en: 'HLR status' },
    icon: 'PhoneCall',
    color: '#34d399',
    usesPlatform: true,
    fields: [
      f('status', 'Statut', 'Status'),
      f('ported', 'Porté', 'Ported'),
      f('roaming', 'Itinérance', 'Roaming'),
      f('mccmnc', 'MCC/MNC', 'MCC/MNC'),
      f('imsi', 'IMSI', 'IMSI'),
      f('checked_at', 'Vérifié le', 'Checked at', 'date')
    ]
  },

  // Opérateur
  {
    id: 'carrier',
    category: 'carrier',
    label: { fr: 'Opérateur', en: 'Carrier' },
    icon: 'RadioTower',
    color: '#fb923c',
    usesPlatform: true,
    fields: [f('country', 'Pays', 'Country'), f('mccmnc', 'MCC/MNC', 'MCC/MNC'), f('network', 'Réseau', 'Network')]
  },

  // Email
  {
    id: 'email',
    category: 'email',
    label: { fr: 'Email', en: 'Email' },
    icon: 'Mail',
    color: '#f472b6',
    placeholder: 'john.doe@gmail.com',
    usesPlatform: true,
    fields: [
      f('provider', 'Fournisseur', 'Provider'),
      f('domain', 'Domaine', 'Domain'),
      f('valid_mx', 'MX valide', 'Valid MX'),
      f('disposable', 'Jetable', 'Disposable'),
      f('canonical', 'Adresse canonique', 'Canonical address'),
      f('mx', 'Serveurs MX', 'MX servers', 'list'),
      f('mail_host', 'Hébergeur mail', 'Mail host'),
      f('spf', 'SPF', 'SPF'),
      f('dmarc_policy', 'Politique DMARC', 'DMARC policy'),
      f('breaches', 'Fuites', 'Breaches', 'list'),
      f('breach_count', 'Nombre de fuites', 'Breach count', 'number'),
      f('leak_fields', 'Données exposées', 'Exposed data', 'list'),
      f('infostealer_count', 'Infections infostealer', 'Infostealer infections', 'number'),
      f('m365_tenant', 'Tenant Microsoft 365', 'Microsoft 365 tenant'),
      f('identity_provider', "Fournisseur d'identité", 'Identity provider'),
      f('infostealer_first_date', 'Première infection', 'First infection', 'date'),
      f('infostealer_last_date', 'Dernière infection', 'Last infection', 'date'),
      f('leak_count', 'Enregistrements fuités', 'Leaked records', 'number'),
      f('hibp_breach_count', 'Fuites (HIBP)', 'Breaches (HIBP)', 'number'),
      f('hibp_paste_count', 'Pastes (HIBP)', 'Pastes (HIBP)', 'number'),
      f('github_commits', 'Commits GitHub', 'GitHub commits', 'number'),
      f('github_commit_names', 'Noms dans les commits', 'Names in commits', 'list'),
      f('github_last_commit_date', 'Dernier commit', 'Last commit', 'date'),
      f('github_repos', 'Dépôts GitHub', 'GitHub repositories', 'list')
    ]
  },

  // Crypto
  {
    id: 'crypto_wallet',
    category: 'crypto',
    label: { fr: 'Portefeuille crypto', en: 'Crypto wallet' },
    icon: 'Wallet',
    color: '#f59e0b',
    usesPlatform: true,
    fields: [
      f('chain', 'Blockchain', 'Chain'),
      f('balance', 'Solde', 'Balance'),
      f('tx_count', 'Transactions', 'Transactions', 'number'),
      f('received', 'Total reçu', 'Total received'),
      f('sent', 'Total envoyé', 'Total sent'),
      f('first_seen', 'Première activité', 'First seen', 'date'),
      f('last_seen', 'Dernière activité', 'Last seen', 'date')
    ]
  },
  {
    id: 'crypto_tx',
    category: 'crypto',
    label: { fr: 'Transaction crypto', en: 'Crypto transaction' },
    icon: 'ArrowLeftRight',
    color: '#fbbf24',
    usesPlatform: true,
    fields: [f('date', 'Date', 'Date', 'date'), f('amount', 'Montant', 'Amount'), f('fee', 'Frais', 'Fee'), f('block', 'Bloc', 'Block', 'number')]
  },

  // Hébergeur
  {
    id: 'hosting',
    category: 'hosting',
    label: { fr: 'Hébergeur', en: 'Hosting provider' },
    icon: 'Server',
    color: '#818cf8',
    usesPlatform: true,
    fields: [f('asn', 'ASN', 'ASN'), f('country', 'Pays', 'Country'), f('abuse_email', 'Contact abus', 'Abuse contact', 'email')]
  }
]

const BY_ID = new Map(ENTITY_TYPES.map((t) => [t.id, t]))

export const FALLBACK_TYPE: EntityTypeDef = {
  id: 'unknown',
  category: 'hardware',
  label: { fr: 'Entité', en: 'Entity' },
  icon: 'Circle',
  color: '#9ca3af',
  fields: []
}

export function getEntityType(id: string): EntityTypeDef {
  return BY_ID.get(id) ?? FALLBACK_TYPE
}

/** Clés reconnues comme des dates pour la frise chronologique. */
export function isDateKey(key: string): boolean {
  return /(^|_)(date|at|seen|since|until|time|timestamp|born|birth_date|compromised)$/.test(key) || key === 'date'
}
