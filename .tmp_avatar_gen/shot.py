"""双主题实测：登录后截大厅，验证新十二生肖头像（卡通 AI + 像素 AI）在真实页面显示。"""
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173"


def login(pg):
    pg.goto(URL)
    pg.wait_for_load_state("networkidle")
    if pg.locator(".lobby-hud").count() == 0:
        pg.fill("input[autocomplete=username]", "alice")
        pg.fill("input[type=password]", "secret123")
        pg.get_by_role("button", name="开始游戏").first.click()
        pg.wait_for_selector(".lobby-hud", timeout=15000)
    pg.wait_for_timeout(700)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    login(pg)
    for theme in ("cartoon", "pixel"):
        pg.evaluate(f"localStorage.setItem('ddz-theme','{theme}')")
        pg.reload()
        pg.wait_for_load_state("networkidle")
        login(pg)
        pg.screenshot(path=f".tmp_avatar_gen/lobby_{theme}.png")
        pg.locator(".player-plate").screenshot(path=f".tmp_avatar_gen/plate_{theme}.png")
        src = pg.eval_on_selector(".player-plate img", "e=>e.getAttribute('src')")
        print(f"{theme}: plate img src = {src}")
    b.close()
