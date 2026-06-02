#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
WMS Service Diagnostic & Tester
Tid: 2026-06-02
Syfte: Testa och diagnosticera Geodata/WMS-tjänster från Naturvårdsverket och Länsstyrelsen
      för att förstå varför de inte laddas i Leaflet på webbklienten.
Körning: python test_wms_services.py
Inga externa beroenden krävs (använder standardbiblioteket urllib och xml).
"""

import os
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import ssl

# Stäng av SSL-verifiering om det skulle strula med lokala certifikat (valfritt, men säkrast för tester)
try:
    ssl_context = ssl._create_unverified_context()
except AttributeError:
    ssl_context = None

SERVICES = {
    "Naturvardsverket (Skyddad Natur)": {
        "url": "https://geodata.naturvardsverket.se/arcgis/services/skyddadnatur/MapServer/WMSServer",
        "layers": ["3", "5", "6"]  # 3 = Naturreservat, 5 = Natura 2000 SAC, 6 = Natura 2000 SPA
    },
    "Lansstyrelsen (Skyddade omraden)": {
        "url": "https://vic-wms.lansstyrelsen.se/arcgis/services/sk_skyddadeomraden_wms_extern/MapServer/WMSServer",
        "layers": ["0", "6", "7"]  # 0 = Naturreservat, 6 = Natura 2000 SAC, 7 = Natura 2000 SPA
    }
}

# Ungefärliga koordinater för Stockholm i Web Mercator (EPSG:3857)
# minX, minY, maxX, maxY för en 256x256-ruta
BBOX_3857 = "1994116,8242475,2003900,8252259"

# Samma område i Geografiska koordinater (EPSG:4326) - WGS84
# WMS 1.1.1 och 1.3.0 har olika axelordning!
# 1.1.1: minLng, minLat, maxLng, maxLat
BBOX_4326_V111 = "17.91,59.28,18.00,59.33"
# 1.3.0: minLat, minLng, maxLat, maxLng (swapped axes)
BBOX_4326_V130 = "59.28,17.91,59.33,18.00"

def log_header(title):
    print("\n" + "=" * 80)
    print(f" {title} ".center(80, "="))
    print("=" * 80)

def fetch_url(url, method="GET", headers=None):
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*"
        }
    
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        if ssl_context:
            res = urllib.request.urlopen(req, context=ssl_context, timeout=12)
        else:
            res = urllib.request.urlopen(req, timeout=12)
        return res, None
    except urllib.error.HTTPError as e:
        return None, e
    except urllib.error.URLError as e:
        return None, e
    except Exception as e:
        return None, e

def test_capabilities(service_name, base_url):
    print(f"\n[1] Hämtar GetCapabilities för: {service_name}")
    print(f"    URL: {base_url}")
    
    cap_url = f"{base_url}?request=GetCapabilities&service=WMS"
    print(f"    Anropar: {cap_url}")
    
    res, err = fetch_url(cap_url)
    if err:
        print(f"    ❌ Kunde inte hämta capabilities: {err}")
        return None
    
    code = res.status
    headers = res.info()
    content_type = headers.get("Content-Type", "").lower()
    
    print(f"    ✅ Statuskod: {code}")
    print(f"    🌐 Content-Type: {content_type}")
    
    # KONTROLLERA CORS-HEADERS
    cors_origin = headers.get("Access-Control-Allow-Origin")
    print(f"    🔒 CORS-Origin header: {cors_origin if cors_origin else 'Saknas ⚠️'}")
    
    if not cors_origin:
        print("    ⚠️  VARNING: Access-Control-Allow-Origin-headern saknas!")
        print("                 Detta betyder att webbläsare blockerar anropet p.g.a CORS-restriktioner")
        print("                 när WMS läggs till direkt på din webbplats (Leaflet)!")
    elif cors_origin == "*":
        print("    ✅ CORS-header tillåter alla ursprung (*). Det är bra!")
    else:
        print(f"    ⚠️  CORS tillåter endast specifikt ursprung: {cors_origin}")

    try:
        body = res.read()
        root = ET.fromstring(body)
        
        # Sök efter WMS-version
        version = root.attrib.get('version', 'Okänd')
        print(f"    📄 WMS Version: {version}")
        
        # Sök efter CRS/SRS-stöd
        crs_list = []
        layers_info = []
        
        # Enkel XPath-sökning för att hitta listor i XML
        # Vi tar bort namespaces för enklare parsning
        xml_str = body.decode('utf-8', errors='ignore')
        # Ta bort standard namespaces för att kunna söka enkelt med ElementTree
        # (Lite fult men robust mot olika versioner av XML i elementtree)
        import re
        xml_clean = re.sub(r'\sxmlns="[^"]+"', '', xml_str)
        xml_clean = re.sub(r'\sxmlns:[^=]+="[^"]+"', '', xml_clean)
        root_clean = ET.fromstring(xml_clean.encode('utf-8'))
        
        # Hitta alla unika CRS/SRS under Capability
        for crs_elem in root_clean.findall(".//CRS") + root_clean.findall(".//SRS"):
            if crs_elem.text and crs_elem.text not in crs_list:
                crs_list.append(crs_elem.text)
        
        print(f"    🗺️  Hittade {len(crs_list)} koordinatsystem (CRS/SRS)")
        for check in ["EPSG:3857", "EPSG:4326", "EPSG:3006"]:
            present = "JA ✅" if check in crs_list else "NEJ ❌"
            print(f"        - {check}: {present}")
            
        # Hitta lager
        top_layer = root_clean.find(".//Capability/Layer")
        if top_layer is not None:
            collect_layers(top_layer, layers_info)
            
        print(f"    📦 Totalt antal lager definierade: {len(layers_info)}")
        print("    🔎 Tillgängliga lager:")
        for l in layers_info[:15]:
            print(f"        Layer ID (Name): '{l['name']}' - Title: '{l['title']}' (Queryable: {l['queryable']})")
        if len(layers_info) > 15:
            print(f"        ...och {len(layers_info) - 15} fler.")
            
        return {
            "version": version,
            "crs_list": crs_list,
            "layers": layers_info,
            "cors_origin": cors_origin
        }
            
    except Exception as parse_err:
        print(f"    ❌ Misslyckades att tolka XML Capabilities: {parse_err}")
        return None

def collect_layers(layer_element, results):
    name = layer_element.find("Name")
    title = layer_element.find("Title")
    queryable = layer_element.attrib.get("queryable", "0")
    
    if name is not None and name.text:
        results.append({
            "name": name.text,
            "title": title.text if title is not None else "Namnlös",
            "queryable": queryable
        })
        
    for child in layer_element.findall("Layer"):
        collect_layers(child, results)

def test_tile_request(service_name, base_url, layer, crs="EPSG:3857", version="1.1.1"):
    print(f"\n[2] Testar GetMap på {service_name} för lager '{layer}' ({crs}, WMS v{version})")
    
    params = {
        "service": "WMS",
        "request": "GetMap",
        "version": version,
        "layers": layer,
        "styles": "",
        "format": "image/png",
        "transparent": "TRUE",
        "width": "256",
        "height": "256"
    }
    
    if crs == "EPSG:3857":
        params["crs" if version == "1.3.0" else "srs"] = "EPSG:3857"
        params["bbox"] = BBOX_3857
    else:  # EPSG:4326
        params["crs" if version == "1.3.0" else "srs"] = "EPSG:4326"
        params["bbox"] = BBOX_4326_V130 if version == "1.3.0" else BBOX_4326_V111

    query_string = "&".join([f"{k.upper()}={v}" for k, v in params.items()])
    request_url = f"{base_url}?{query_string}"
    
    print(f"    Anrop: {request_url}")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "image/png,image/*;q=0.8,*/*;q=0.5"
    }
    
    res, err = fetch_url(request_url, headers=headers)
    
    if err:
        print(f"    ❌ HTTP Error / Request misslyckades: {err}")
        if hasattr(err, 'read'):
            try:
                err_body = err.read().decode('utf-8', errors='ignore')
                print(f"    📄 Serverns felsvar: {err_body[:400]}...")
            except:
                pass
        return False

    headers = res.info()
    content_type = headers.get("Content-Type", "").lower()
    content_length = headers.get("Content-Length", "Okänd")
    
    print(f"    ✅ Svar mottaget. Status: {res.status}")
    print(f"    🌐 Content-Type: {content_type}")
    print(f"    bytes: {content_length}")
    
    file_prefix = service_name.lower().replace(" ", "_").replace("(", "").replace(")", "")
    
    if "image" in content_type:
        filename = f"test_tile_{file_prefix}_layer_{layer}_{crs.replace(':', '')}_v{version.replace('.', '')}.png"
        try:
            body = res.read()
            with open(filename, "wb") as f:
                f.write(body)
            print(f"    🎉 Framgång! Bild sparad som '{filename}' ({len(body)} bytes)")
            return True
        except Exception as file_err:
            print(f"    ❌ Kunde inte skriva filen till disken: {file_err}")
            return False
    else:
        # Förmodligen ett XML-felsvar fast vi bad om en bild
        try:
            body = res.read().decode('utf-8', errors='ignore')
            print("    ⚠️  Varning: Svaret är INTE en bild! Felsvar från servern i XML/text:")
            print("-" * 60)
            print(body[:600])
            print("-" * 60)
        except Exception as e:
            print(f"    Kunde inte läsa felmeddelande: {e}")
        return False

def main():
    log_header("WMS DIAGNOS- OCH TESTVERKTYG (SVERIGE GEODATA)")
    print(f"Python-version: {sys.version}")
    print(f"Nuvarande sökväg: {os.getcwd()}")
    
    results_summary = []
    
    for name, config in SERVICES.items():
        log_header(name)
        
        # 1. Hämta capabilities
        caps = test_capabilities(name, config["url"])
        
        if not caps:
            results_summary.append((name, "Capabilities misslyckades", "N/A"))
            continue
        
        # 2. Testa GetMap med olika konfigurationer
        # Vi testar med första lagret i listan
        first_layer = config["layers"][0]
        
        print("\n[RUNDA A] Testar EPSG:3857 (Standard Web Mercator - Leaflet standard)")
        success_3857_v111 = test_tile_request(name, config["url"], first_layer, crs="EPSG:3857", version="1.1.1")
        success_3857_v130 = test_tile_request(name, config["url"], first_layer, crs="EPSG:3857", version="1.3.0")
        
        print("\n[RUNDA B] Testar EPSG:4326 (Geografisk / WGS84)")
        success_4326_v111 = test_tile_request(name, config["url"], first_layer, crs="EPSG:4326", version="1.1.1")
        success_4326_v130 = test_tile_request(name, config["url"], first_layer, crs="EPSG:4326", version="1.3.0")
        
        # Sammanfattning för denna tjänst
        status_str = []
        if success_3857_v111: status_str.append("3857-v1.1.1")
        if success_3857_v130: status_str.append("3857-v1.3.0")
        if success_4326_v111: status_str.append("4326-v1.1.1")
        if success_4326_v130: status_str.append("4326-v1.3.0")
        
        working_modes = ", ".join(status_str) if status_str else "Inga fungerade!"
        cors_info = "OK (*)" if caps["cors_origin"] == "*" else f"Kritiskt fel: Saknas CORS ({caps['cors_origin']})"
        
        results_summary.append((name, working_modes, cors_info))

    log_header("DIAGNOS SAMMANFATTNING OCH REKOMMENDATIONER")
    
    print(f"{'Tjänst':<40} | {'Fungerande kombinationer':<25} | {'CORS-status':<15}")
    print("-" * 88)
    for service, modes, cors in results_summary:
        print(f"{service:<40} | {modes:<25} | {cors:<15}")
        
    print("\n💡 REKOMMENDATIONER FÖR WEBBLÄSARE OCH LEAFLET:")
    print("1. CORS (Access-Control-Allow-Origin):")
    print("   - Om 'CORS-status' visar 'Saknas', kommer webbläsaren att BLOCKERA WMS-anropen i Leaflet canvas.")
    print("   - Lösning: Eftersom vi inte äger myndigheternas servrar, måste vi antingen proxies anropen")
    print("     genom vår egen backend (/api) eller använda standard <WMSTileLayer> på ett sätt där webbläsaren")
    print("     tolkar det rent som en bild (vilket oftast är fallet om 'transparent=true' inställningen inte tvingar")
    print("     fram CORS eller crossOrigin: 'anonymous'). Leaflet sätter ibland crossOrigin='anonymous' per default.")
    print("     Prova att lägga till `crossOrigin: false` eller `crossOrigin: ''` i Leaflet Tile-options för att hindra")
    print("     webbläsaren från att kräva CORS-huvuden för enkla <img> element!")
    
    print("\n2. EPSG-stöd:")
    print("   - Leaflet använder EPSG:3857 som standard. Om EPSG:3857 saknas eller ger XML-fel i loggen ovan,")
    print("     så måste man tvinga Leaflet att projicera om, eller använda en svensk projektion (t.ex. med Proj4Leaflet).")
    print("     Men sanningen är att de flesta stora svenska statliga tjänster idag stödjer EPSG:3857 på sina publika portaler.")

    print("\n3. WMS-Version:")
    print("   - Om 1.1.1 fungerade men 1.3.0 fallerade (eller vice versa), beror det på axelordningen i EPSG:4326")
    print("     eller att servern är en äldre ArcGIS Server. Ange explicit `version: '1.1.1'` i din Leaflet WMSTileLayer")
    print("     om v1.1.1 visade sig fungera bättre.")
    
    print("\nKör klart! Kontrollera om bilderna skapades i mappen för att se att tjänsterna fungerar i sig själv!")
    print("=" * 80)

if __name__ == "__main__":
    main()
