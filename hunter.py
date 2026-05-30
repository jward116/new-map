import sys
import json
import os
from datetime import datetime

PROFILE_FILE = "master_profile.json"
_llm = None

def get_llm():
    global _llm
    if _llm is None:
        from langchain_ollama import OllamaLLM
        _llm = OllamaLLM(model="llama3.2", temperature=0.65)
    return _llm

def load_profile():
    if os.path.exists(PROFILE_FILE):
        with open(PROFILE_FILE, "r") as f:
            return json.load(f)
    return {"experience": "", "reframed_skills": [], "goals": {"salary": 160000, "hours": "flexible or normal hours, remote/hybrid preferred"}}

def save_profile(profile):
    with open(PROFILE_FILE, "w") as f:
        json.dump(profile, f, indent=2)

def setup():
    print("🔨 ResuForge: The Hunter - Built for Missouri LE Officer")
    print("Paste your full law enforcement experience below. Press Enter twice when done.\n")
    lines = []
    while True:
        line = input()
        if line.strip() == "" and len(lines) > 0:
            break
        lines.append(line)
    experience = "\n".join(lines).strip()

    print("\nReframing your cop experience into high-paying cyber roles...")
    prompt = f"""You are the world's best career coach for law enforcement officers moving into cybersecurity in 2026.
Focus on SOC Analyst, Incident Response, Compliance, Threat Intelligence, Cybersecurity Operations roles ($140k-$190k+, flexible/normal hours, remote/hybrid).
Reframe this experience into 10-14 powerful, quantifiable, ATS-optimized bullets.
Emphasize: high-pressure incident response, documentation, compliance, team coordination, risk assessment, quick learning.
Experience:
{experience}

Output ONLY the clean bullet points."""
    reframed = get_llm().invoke(prompt).strip()
    profile = {"experience": experience, "reframed_skills": reframed.split("\n"), "goals": {"salary": 160000, "hours": "flexible or normal hours, remote/hybrid"}}
    save_profile(profile)
    print("\n✅ MASTER PROFILE CREATED - YOUR BACKGROUND IS NOW A SUPERPOWER")
    print(reframed)

def forge(job_desc):
    profile = load_profile()
    if not profile["reframed_skills"]:
        print("Run 'python hunter.py setup' first!")
        return
    print(f"\n🔨 Forging application for: {job_desc}")
    prompt = f"""Job: {job_desc}
My reframed skills: {chr(10).join(profile['reframed_skills'])}
Goals: ${profile['goals']['salary']}+, flexible/normal hours, remote/hybrid, Missouri or fully remote.

Create:
1. 8-12 perfect ATS-friendly resume bullets
2. A confident, natural cover letter in first person"""
    result = get_llm().invoke(prompt)

    filename = f"Hunter_Application_{datetime.now().strftime('%Y%m%d_%H%M')}"
    with open(f"{filename}.txt", "w") as f:
        f.write(result)
    from fpdf import FPDF
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=11)
    pdf.multi_cell(0, 8, result)
    pdf.output(f"{filename}.pdf")

    print("\n" + "="*80)
    print(result)
    print("="*80)
    print(f"\n✅ Saved: {filename}.pdf  ← Copy this PDF into LinkedIn/Indeed Easy Apply RIGHT NOW")

def real_hunt():
    print("🔍 REAL LIVE HUNT - Jobs hiring RIGHT NOW for former law enforcement officers")
    print("\nCopy these links and start applying today:")
    print("1. Indeed - 507+ Law Enforcement Cyber Security jobs: https://www.indeed.com/q-law-enforcement-cyber-security-jobs.html")
    print("2. Remote SOC Analyst jobs: https://www.indeed.com/q-remote-soc-analyst-jobs.html")
    print("3. Remote Cybersecurity Analyst $100k+: https://www.indeed.com/q-remote-cyber-security-$100,000-jobs.html")
    print("4. LinkedIn remote/hybrid search: https://www.linkedin.com/jobs/search/?keywords=cybersecurity%20operations%20OR%20soc%20analyst%20OR%20incident%20response%20law%20enforcement&location=United%20States&f_WT=2,3")
    print("\nPick any job title you see and run: python hunter.py forge \"Exact Job Title\"")

def interview(question):
    profile = load_profile()
    prompt = f"""Question: {question}
Use my law enforcement background reframed for cyber roles.
Give a short, confident STAR answer."""
    print("\n🎤 STAR ANSWER:\n")
    print(get_llm().invoke(prompt))

def copilot(task):
    prompt = f"""You are my daily cybersecurity co-pilot. I come from law enforcement.
Help me handle this task professionally:
{task}"""
    print("\n💼 CO-PILOT:\n")
    print(get_llm().invoke(prompt))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Commands:")
        print("  python hunter.py setup")
        print("  python hunter.py real_hunt")
        print("  python hunter.py forge \"Job Title or description\"")
        print("  python hunter.py interview \"Question\"")
        print("  python hunter.py copilot \"Task\"")
        sys.exit(1)

    cmd = sys.argv[1].lower()
    if cmd == "setup":
        setup()
    elif cmd == "real_hunt":
        real_hunt()
    elif cmd == "forge":
        job = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else input("Paste job title/description: ")
        forge(job)
    elif cmd == "interview":
        q = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else input("Paste question: ")
        interview(q)
    elif cmd == "copilot":
        t = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else input("Paste task: ")
        copilot(t)
    else:
        print("Unknown command.")
