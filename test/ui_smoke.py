import os, subprocess, time, tempfile, sys
from playwright.sync_api import sync_playwright
port = "3917"; token = "smoke-token"
data = tempfile.mkdtemp()
env = dict(os.environ, PORT=port, APP_TOKEN=token, DATA_DIR=data, NODE_ENV="production")
env.pop("DATABASE_URL", None)
srv = subprocess.Popen(["node", "server.js"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 420, "height": 900})
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://localhost:{port}/")
        pg.wait_for_selector("input[type=password]")
        pg.fill("input[type=password]", "wrong"); pg.keyboard.press("Enter")
        pg.wait_for_selector(".notice")
        pg.fill("input[type=password]", token); pg.keyboard.press("Enter")
        pg.wait_for_selector("text=Items in scope")
        assert "169" in pg.inner_text(".stats"), pg.inner_text(".stats")
        # flashcards
        pg.click("text=Flashcards")
        pg.wait_for_selector(".card")
        pg.keyboard.press("Space"); pg.keyboard.press("3")
        pg.keyboard.press("Space"); pg.keyboard.press("1")
        # finish
        pg.click("text=Finish")
        pg.wait_for_selector("text=Session complete")
        pg.click("text=Back to home")
        # quiz
        pg.click("text=Quiz")
        pg.wait_for_selector(".opt")
        pg.keyboard.press("a")
        pg.wait_for_selector(".opt.correct")
        pg.keyboard.press("Space")
        pg.click("text=Finish"); pg.wait_for_selector("text=Session complete")
        pg.click("text=Back to home")
        # every mode renders and can be revealed
        for name in ["Predict the output", "Spot the bug", "Explain aloud", "Write from memory"]:
            pg.click(f".modebtn:has-text('{name}')")
            pg.wait_for_selector(".card")
            pg.click(".actions .btn.primary")
            pg.wait_for_selector(".rating:not([hidden])")
            pg.keyboard.press("2")
            pg.click("text=Finish"); pg.click("text=Back to home")
        pg.click("text=Mock interview")
        pg.wait_for_selector(".card")
        pg.click("text=Quit")
        time.sleep(2.5)
        pg.screenshot(path="/tmp/claude-0/-home-claude/72d2be92-9deb-5aa6-96ec-f5817608104f/scratchpad/home.png", full_page=True)
        # reload with fresh storage: progress comes back from server
        ctx = b.new_context()
        pg2 = ctx.new_page()
        pg2.on("pageerror", lambda e: errors.append(str(e)))
        pg2.goto(f"http://localhost:{port}/")
        pg2.fill("input[type=password]", token); pg2.keyboard.press("Enter")
        pg2.wait_for_selector("text=Items in scope")
        pg2.wait_for_function("document.querySelector('.stats').innerText.match(/\\n?[1-9]\\d*\\s*\\n?Studied/) || true")
        time.sleep(1.5)
        txt = pg2.inner_text(".stats")
        print("Fresh device stats:", txt.replace("\n", " "))
        assert "Studied" in txt
        studied = int(txt.split("Studied")[0].split()[-1])
        assert studied >= 5, studied
        b.close()
finally:
    srv.terminate()
print("console errors:", errors)
sys.exit(1 if errors else 0)
