import subprocess
import os
import sys

def run_command(command, cwd=None):
    """Effectively run a shell command and stream output."""
    print(f"\n>>> Running: {command}")
    process = subprocess.Popen(
        command,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=cwd
    )
    
    for line in process.stdout:
        print(line, end="")
        
    process.wait()
    return process.returncode

def main():
    # Configuration
    image_name = "demensdeum/mars-miners-client"
    
    # Determine the mobile-app directory
    # If run from scripts/, it's parent. If run from mobile-app/, it's current.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    mobile_app_dir = os.path.abspath(os.path.join(script_dir, ".."))
    
    if not os.path.exists(os.path.join(mobile_app_dir, "Dockerfile")):
        print(f"Error: Could not find Dockerfile in {mobile_app_dir}")
        sys.exit(1)
        
    print(f"Mars Miners Build System")
    print(f"Working directory: {mobile_app_dir}")
    print(f"Target image: {image_name}")
    
    # 1. Build
    build_cmd = f"docker build -t {image_name} ."
    if run_command(build_cmd, cwd=mobile_app_dir) != 0:
        print("\n[!] Docker build failed.")
        sys.exit(1)
        
    # 2. Push
    push_cmd = f"docker push {image_name}"
    if run_command(push_cmd, cwd=mobile_app_dir) != 0:
        print("\n[!] Docker push failed.")
        print("Note: Make sure you are logged in with 'docker login'")
        sys.exit(1)
        
    print("\n[+] Build and Push completed successfully!")

if __name__ == "__main__":
    main()
