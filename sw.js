// ============================================
// SERVICE WORKER - Python Data Exercices
// Stratégie : Cache First pour Pyodide, Network First pour le reste
// ============================================

const CACHE_VERSION = 'v2.0.0';
const STATIC_CACHE = `pyexercices-static-${CACHE_VERSION}`;
const PYODIDE_CACHE = `pyodide-cache-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `pyexercices-dynamic-${CACHE_VERSION}`;

// Ressources statiques à mettre en cache immédiatement
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/syntaxe.html',
    '/manifest.json',
    '/offline.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/theme/darcula.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/python/python.min.js'
];

// Pyodide - garder en cache très longtemps
const PYODIDE_ASSETS = [
    'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js',
    'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.asm.js',
    'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.asm.wasm'
];

// ============================================
// INSTALLATION
// ============================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installation...');
    
    event.waitUntil(
        Promise.all([
            // Cache statique
            caches.open(STATIC_CACHE).then((cache) => {
                console.log('[SW] Mise en cache des assets statiques');
                return cache.addAll(STATIC_ASSETS);
            }),
            // Cache Pyodide (préchargement)
            caches.open(PYODIDE_CACHE).then((cache) => {
                console.log('[SW] Préchargement de Pyodide');
                return Promise.allSettled(
                    PYODIDE_ASSETS.map(url => 
                        fetch(url, { mode: 'no-cors' })
                            .then(response => {
                                if (response.ok) {
                                    return cache.put(url, response);
                                }
                            })
                            .catch(err => console.log('[SW] Erreur préchargement:', url, err))
                    )
                );
            })
        ])
    );
    
    // Activer immédiatement
    self.skipWaiting();
});

// ============================================
// ACTIVATION
// ============================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation...');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => {
                        // Supprimer les anciens caches
                        return name.startsWith('pyexercices-') && 
                               name !== STATIC_CACHE && 
                               name !== PYODIDE_CACHE && 
                               name !== DYNAMIC_CACHE;
                    })
                    .map((name) => {
                        console.log('[SW] Suppression ancien cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // Prendre le contrôle de toutes les pages
            return self.clients.claim();
        })
    );
});

// ============================================
// STRATÉGIE DE CACHE
// ============================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Ignorer les requêtes non-GET
    if (event.request.method !== 'GET') return;
    
    // Ignorer les requêtes Chrome DevTools
    if (url.hostname === 'localhost' && url.port === '9222') return;
    
    // Stratégie 1 : Pyodide - Cache First (garder très longtemps)
    if (url.href.includes('pyodide') || url.href.includes('cdn.jsdelivr.net')) {
        event.respondWith(cacheFirstStrategy(event.request, PYODIDE_CACHE));
        return;
    }
    
    // Stratégie 2 : Assets statiques - Cache First
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirstStrategy(event.request, STATIC_CACHE));
        return;
    }
    
    // Stratégie 3 : HTML - Network First (pour avoir la dernière version)
    if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
        event.respondWith(networkFirstStrategy(event.request, STATIC_CACHE));
        return;
    }
    
    // Stratégie 4 : Autres - Network First avec cache dynamique
    event.respondWith(networkFirstStrategy(event.request, DYNAMIC_CACHE));
});

// ============================================
// STRATÉGIES
// ============================================

// Cache First : Priorité au cache
async function cacheFirstStrategy(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) {
        // Mise à jour en arrière-plan (stale-while-revalidate)
        fetchAndCache(request, cacheName).catch(() => {});
        return cached;
    }
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.log('[SW] Offline - Ressource non disponible:', request.url);
        return new Response('Ressource non disponible hors-ligne', { status: 503 });
    }
}

// Network First : Priorité au réseau
async function networkFirstStrategy(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        
        // Page offline pour les documents HTML
        if (request.destination === 'document') {
            return caches.match('/offline.html');
        }
        
        return new Response('Hors-ligne', { status: 503 });
    }
}

// Mise en cache en arrière-plan
async function fetchAndCache(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response);
        }
    } catch (error) {
        // Silencieux
    }
}

// Vérifier si c'est un asset statique
function isStaticAsset(url) {
    const staticPatterns = [
        'cdnjs.cloudflare.com',
        'codemirror',
        'font-awesome',
        '.css',
        '.woff2',
        '.ttf'
    ];
    return staticPatterns.some(pattern => url.href.includes(pattern));
}

// ============================================
// MESSAGES
// ============================================
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data === 'getVersion') {
        event.ports[0].postMessage({ version: CACHE_VERSION });
    }
    
    if (event.data === 'clearAllCaches') {
        event.waitUntil(
            caches.keys().then(names => 
                Promise.all(names.map(name => caches.delete(name)))
            )
        );
    }
});