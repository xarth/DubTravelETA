"""Download and extract the Dublin Bus GTFS static data."""
import os
import sys
import zipfile
import requests

GTFS_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_Dublin_Bus.zip"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
GTFS_DIR = os.path.join(DATA_DIR, "gtfs")
ZIP_PATH = os.path.join(DATA_DIR, "GTFS_Dublin_Bus.zip")

EXPECTED_FILES = [
    "stops.txt", "routes.txt", "trips.txt",
    "stop_times.txt", "shapes.txt", "calendar.txt"
]


def main():
    os.makedirs(GTFS_DIR, exist_ok=True)

    print(f"Downloading Dublin Bus GTFS data from:\n  {GTFS_URL}")
    resp = requests.get(GTFS_URL, stream=True, timeout=120)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    with open(ZIP_PATH, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r  Progress: {pct}% ({downloaded // 1024} KB)", end="", flush=True)
    print(f"\n  Saved to {ZIP_PATH}")

    print("Extracting...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        zf.extractall(GTFS_DIR)
    print(f"  Extracted to {GTFS_DIR}")

    # Verify expected files
    missing = [f for f in EXPECTED_FILES if not os.path.isfile(os.path.join(GTFS_DIR, f))]
    if missing:
        print(f"WARNING: Missing expected files: {missing}")
        sys.exit(1)
    else:
        print("  All expected GTFS files present.")

    # Clean up zip
    os.remove(ZIP_PATH)
    print("Done.")


if __name__ == "__main__":
    main()
