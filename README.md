# Balise – rando hors-ligne

Application web (PWA) personnelle pour randonner sans se perdre, **même sans réseau** :
pas de compte, pas de réseau social, tout reste sur ton téléphone.

## Ce qu'elle fait

- **Carte** : OpenTopoMap (monde, courbes de niveau), IGN Plan et photos aériennes IGN (France), OpenStreetMap (en ligne).
- **Importer des itinéraires** : fichiers GPX, KML ou GeoJSON (exportés d'un site de rando, d'une montre GPS, de Visorando, IGNrando…).
- **Tracer un itinéraire** en touchant la carte ; le tracé suit les sentiers (calcul via BRouter, nécessite du réseau au moment du tracé).
- **Télécharger la carte hors-ligne** le long de l'itinéraire (marge réglable de 300 m à 3 km), ou de la zone affichée.
- **Navigation GPS** : position, distance et dénivelé restants, temps estimé, profil altimétrique,
  **alerte sonore + vibration si tu sors de l'itinéraire** (> 50 m) avec la direction pour revenir sur le sentier.
- **Enregistrer sa trace** et l'exporter en GPX.
- **Bouton SOS** : affiche tes coordonnées GPS (décimales + degrés/minutes/secondes), appel du 112, copie ou envoi par SMS.

## Installer sur ton téléphone

L'application doit être servie en HTTPS (obligatoire pour le GPS). Le plus simple : GitHub Pages, gratuit.

1. Sur GitHub, dans ce dépôt : **Settings → Pages**.
2. *Source* : **Deploy from a branch**, choisis la branche (par ex. `main`) et le dossier **/ (root)**, puis **Save**.
3. Après 1 à 2 minutes, l'adresse s'affiche (du type `https://<ton-compte>.github.io/<depot>/`).
4. Ouvre cette adresse sur ton téléphone :
   - **Android (Chrome)** : menu ⋮ → *Installer l'application* (ou bouton « Installer » dans l'onglet Itinéraires).
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
5. Autorise la localisation quand l'appli la demande.

## Avant de partir (à faire avec du réseau, idéalement en Wi-Fi)

1. Importe ou trace ton itinéraire.
2. Ouvre-le → **Carte hors-ligne → Télécharger**. Attends le ✓.
3. **Teste** : passe en mode avion, ouvre l'appli, vérifie que la carte s'affiche le long du trajet.

## Limites à connaître (important pour ta sécurité)

- **Ne compte pas uniquement sur ton téléphone** : batterie, froid, chute… Emporte une carte papier
  (IGN TOP 25), une boussole, une batterie externe, et préviens quelqu'un de ton itinéraire.
- Une application web **ne reçoit plus le GPS quand l'écran est verrouillé ou l'appli en arrière-plan**.
  Pendant la navigation, l'appli garde l'écran allumé : baisse la luminosité pour économiser la batterie.
  L'alerte « hors itinéraire » ne fonctionne que si l'appli est au premier plan.
- Sur iPhone, Safari peut effacer les données d'un site non utilisé pendant plusieurs semaines :
  installe l'appli sur l'écran d'accueil et retélécharge la carte avant chaque sortie.
- Le tracé « suivre les sentiers » et la recherche de lieux nécessitent du réseau.
  Hors-ligne, tu peux taper des coordonnées dans la barre de recherche (ex. `45.92, 6.87`).

## Technique

HTML/CSS/JavaScript sans compilation. [Leaflet](https://leafletjs.com) est inclus dans `vendor/`.
Itinéraires stockés dans IndexedDB, tuiles de carte dans le Cache Storage, servies hors-ligne par `sw.js`.
Pour tester en local : `python3 -m http.server` puis http://localhost:8000.

Données cartographiques : © IGN – Géoplateforme, © OpenTopoMap (CC-BY-SA), © contributeurs OpenStreetMap.
Calcul d'itinéraire : BRouter (brouter.de). Recherche : Nominatim.
