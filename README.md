This is all Vibe coded, use at your own risk.
```
Deploy steps
1. Copy the project to your server (git clone, scp, whatever you prefer)

2. Create the .env file on the server:


NTA_API_KEY=<your key>
3. Build and run:


docker compose up -d --build
The app will be running on port 3000.

Public access
Since you're running Docker and want public access, you likely already have a reverse proxy. The typical setup:

If you use Traefik/Nginx Proxy Manager/Caddy - point a domain or subdomain at the container on port 3000 and let it handle SSL. Add the appropriate labels to the docker-compose if using Traefik.
If you don't have a reverse proxy yet - Caddy is the simplest option. It auto-provisions HTTPS via Let's Encrypt.
You'll need a domain (or free subdomain from DuckDNS/No-IP) pointing at your home IP, and port 443 forwarded to your reverse proxy.
Important for GPS to work: The browser Geolocation API requires HTTPS. So you'll need SSL via your reverse proxy for the GPS button to function when accessing remotely. The "Map" click method will still work over HTTP.

Updating GTFS data
If Dublin Bus updates their routes, re-run the parse script locally and rebuild the image:


python scripts/download_gtfs.py
python scripts/parse_gtfs.py
docker compose up -d --build
```

```
Synology uses Container Manager (previously called "Docker" in DSM). Here's how to get it running:

Option 1: Build on your PC, transfer the image
This is the simplest approach since Synology's Container Manager doesn't have a great build workflow.

On your PC (where the project is), run:


docker build -t traveleta .
docker save traveleta -o traveleta.tar
On your Synology:

Copy traveleta.tar to your Synology (via SMB share, SCP, etc.)
Open Container Manager in DSM
Go to Image > Import > Import from file and select traveleta.tar
Once imported, go to Container > Create
Select the traveleta image
Configure:
Container name: traveleta
Enable auto-restart: checked
Port Settings: Local port 3000 -> Container port 3000 (TCP)
Environment Variables: Add NTA_API_KEY = your-api-key
Environment Variables: Add PORT = 3000
Click Done to start it

Public access via Synology
Synology has a built-in reverse proxy that handles SSL:

Control Panel > Login Portal > Advanced > Reverse Proxy
Click Create:
Description: TravelETA
Source: HTTPS, your hostname (e.g. bus.yourdomain.com), port 443
Destination: HTTP, localhost, port 3000
For SSL, go to Control Panel > Security > Certificate and either import your own or use the built-in Let's Encrypt integration to issue a cert for your domain
You'll still need your domain's DNS pointing to your Synology's public IP, and port 443 forwarded on your router.

Updating later
When Dublin Bus updates routes, rebuild on your PC and re-import:

python scripts/download_gtfs.py
python scripts/parse_gtfs.py
docker build -t traveleta .
docker save traveleta -o traveleta.tar
Then import the new tar on Synology and recreate the container.
```
