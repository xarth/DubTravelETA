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
