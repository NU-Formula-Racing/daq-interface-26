"""
Google Sheets to CSV exporter.

This script downloads a Google Sheet and saves it as a CSV file locally.

Requirements:
    pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client

Setup:
1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable Google Sheets API and Google Drive API
4. Create a Service Account (or OAuth 2.0 Desktop App credentials)
5. Download credentials JSON and save as 'credentials.json' in the same directory as this script
6. Update SPREADSHEET_ID and SHEET_NAME below

If using Service Account:
    - Share the Google Sheet with the service account email
    
If using OAuth 2.0:
    - First run will open a browser to authorize access
"""

import csv
import os
from typing import List, Dict, Any
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Configuration
SPREADSHEET_ID = ""  # TODO: Replace with your Google Sheet ID
SHEET_NAME = "Sheet1"  # TODO: Replace with the sheet name you want to export
OUTPUT_FILE = "output.csv"  # Local CSV filename
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly", 
          "https://www.googleapis.com/auth/drive.readonly"]


def authenticate_oauth2():
    """Authenticate using OAuth 2.0 (Desktop App credentials)."""
    creds = None
    token_file = "token.json"
    
    # Load cached credentials if they exist
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
    
    # If no valid credentials, get new ones
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)
        
        # Save credentials for next run
        with open(token_file, "w") as token:
            token.write(creds.to_json())
    
    return creds


def authenticate_service_account():
    """Authenticate using Service Account credentials."""
    creds = ServiceAccountCredentials.from_service_account_file(
        "credentials.json", scopes=SCOPES
    )
    return creds


def fetch_sheet_data(creds, spreadsheet_id: str, sheet_name: str) -> List[List[str]]:
    """
    Fetch data from a Google Sheet.
    
    Args:
        creds: Authenticated credentials
        spreadsheet_id: ID of the Google Sheet
        sheet_name: Name of the sheet to fetch
        
    Returns:
        List of rows (each row is a list of cell values)
    """
    service = build("sheets", "v4", credentials=creds)
    sheet = service.spreadsheets()
    
    # Fetch all data from the sheet
    result = sheet.values().get(
        spreadsheetId=spreadsheet_id,
        range=sheet_name
    ).execute()
    
    rows = result.get("values", [])
    return rows


def write_csv(rows: List[List[str]], output_file: str) -> None:
    """
    Write rows to a CSV file.
    
    Args:
        rows: List of rows to write
        output_file: Path to output CSV file
    """
    if not rows:
        print("No data to write.")
        return
    
    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    
    print(f"✓ CSV exported: {output_file}")
    print(f"  Rows: {len(rows)}, Columns: {len(rows[0]) if rows else 0}")


def main():
    # Validate configuration
    if not SPREADSHEET_ID:
        print("ERROR: SPREADSHEET_ID not configured. Update the script with your Google Sheet ID.")
        return
    
    print("Google Sheets to CSV Exporter")
    print("=" * 50)
    
    # Choose authentication method
    use_service_account = input(
        "Use Service Account? (y/n, default: n for OAuth2): "
    ).lower().strip() == "y"
    
    try:
        # Authenticate
        if use_service_account:
            print("Authenticating with Service Account...")
            creds = authenticate_service_account()
        else:
            print("Authenticating with OAuth 2.0...")
            creds = authenticate_oauth2()
        
        print("✓ Authentication successful\n")
        
        # Fetch sheet data
        print(f"Fetching sheet: {SHEET_NAME}...")
        rows = fetch_sheet_data(creds, SPREADSHEET_ID, SHEET_NAME)
        
        if not rows:
            print("ERROR: No data found in the sheet.")
            return
        
        print(f"✓ Fetched {len(rows)} rows\n")
        
        # Write to CSV
        print(f"Writing to {OUTPUT_FILE}...")
        write_csv(rows, OUTPUT_FILE)
        
        print("\n✓ Done!")
        
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        print("Make sure 'credentials.json' exists in the current directory.")
    except Exception as e:
        print(f"ERROR: {e}")


if __name__ == "__main__":
    main()
