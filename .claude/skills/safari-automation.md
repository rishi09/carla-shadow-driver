# Safari Browser Automation

Automate Safari browser for web scraping, testing, form filling, and screenshots using Selenium + Safari Technology Preview.

## Prerequisites

**User must start safaridriver in a separate terminal before automation:**

```bash
/Applications/Safari\ Technology\ Preview.app/Contents/MacOS/safaridriver -p 4445
```

Keep that terminal open. The driver listens on port 4445.

## One-Time Setup (Already Done)

These steps were completed during initial setup:
1. `brew install --cask safari-technology-preview`
2. `sudo safaridriver --enable` (in user's terminal)
3. Safari > Develop > Allow Remote Automation (checked)
4. `pip install selenium` (if not installed)

## Connection Template

```python
from selenium import webdriver
from selenium.webdriver.safari.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

# Connect to Safari Technology Preview on port 4445
options = Options()
options.use_technology_preview = True
driver = webdriver.Remote(command_executor='http://localhost:4445', options=options)
driver.set_window_size(1280, 900)

# Your automation here...

driver.quit()
```

## Common Patterns

### Navigate and Screenshot
```python
driver.get('https://example.com')
time.sleep(2)
driver.save_screenshot('/tmp/screenshot.png')
```

### Click Elements
```python
driver.find_element(By.ID, "button-id").click()
driver.find_element(By.XPATH, "//button[text()='Submit']").click()
driver.find_element(By.CSS_SELECTOR, ".my-class").click()
```

### Fill Forms
```python
field = driver.find_element(By.NAME, "email")
field.clear()
field.send_keys("user@example.com")
field.send_keys(Keys.RETURN)
```

### Wait for Elements
```python
element = WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.ID, "dynamic-element"))
)
```

### Dismiss Popups
```python
try:
    close_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Close')]")
    close_btn.click()
except:
    pass
```

### Human-Like Delays
```python
import random
time.sleep(random.uniform(1.5, 3.5))
```

## Limitations

- CAPTCHA/bot detection on major sites (Google, Amazon, social media)
- Requires safaridriver running in separate terminal
- Cannot bypass Cloudflare/PerimeterX easily
- No true headless mode (window may flash briefly)

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Could not create session" | Start safaridriver in separate terminal |
| "safaridriver not configured" | Run `sudo safaridriver --enable` |
| Element not found | Add `time.sleep()` or use `WebDriverWait` |
| CAPTCHA appears | Site detected automation - add delays, try different site |
