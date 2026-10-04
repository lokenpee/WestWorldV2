@echo off
chcp 936 >nul
title WestWorld V2 启动器
cd /d "%~dp0app"

set PORT=5199
set URL=http://localhost:%PORT%

echo.
echo ==========================================
echo    WestWorld V2
echo    导入小说  ^-^>  提取资产  ^-^>  事件网络
echo ==========================================
echo.

rem ---- 1. 检查运行环境 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [缺少] 没有找到 Node.js
  echo.
  echo 请先安装 Node.js 22 或更高版本：
  echo     https://nodejs.org/
  echo 装完再双击这个文件。
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [缺少] 没有找到 pnpm
  echo.
  echo 请打开一个新的命令行窗口，运行这一行：
  echo     npm install -g pnpm
  echo 装完再双击这个文件。
  echo.
  pause
  exit /b 1
)

rem ---- 2. 服务已经在跑？直接开浏览器 ----
netstat -ano | findstr ":%PORT%" | findstr LISTENING >nul 2>nul
if not errorlevel 1 (
  echo 服务已经在运行，直接打开浏览器...
  start "" %URL%
  exit /b 0
)

rem ---- 3. 首次运行要装依赖 ----
if not exist "node_modules" (
  echo 首次运行，正在安装依赖（可能要几分钟，请耐心等）...
  echo.
  call pnpm install
  if errorlevel 1 (
    echo.
    echo [失败] 依赖安装失败，请把上面的报错发给开发者。
    pause
    exit /b 1
  )
  echo.
  echo 依赖安装完成。
  echo.
)

rem ---- 4. 启动服务（另开一个窗口，方便看日志）----
echo 正在启动服务...
start "WestWorld V2 服务 - 关掉这个窗口即停止" cmd /k "pnpm dev --port %PORT% --strictPort"

echo 等待服务就绪...
rem 用 ping 代替 timeout：timeout 在输入被重定向时会直接失败
ping -n 6 127.0.0.1 >nul

set /a waited=0
:waitloop
netstat -ano | findstr ":%PORT%" | findstr LISTENING >nul 2>nul
if not errorlevel 1 goto ready
set /a waited+=1
if %waited% geq 25 (
  echo.
  echo [警告] 服务 25 秒内没有起来。
  echo 请看另一个窗口（标题是 "WestWorld V2 服务..."）里的报错信息。
  echo.
  pause
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto waitloop

:ready
echo 服务已就绪，正在打开浏览器...
start "" %URL%
echo.
echo ==========================================
echo   已启动
echo.
echo   访问地址： %URL%
echo   停止服务： 关掉标题为 "WestWorld V2 服务" 的那个窗口
echo.
echo   第一次用？先去「设置」里填 DeepSeek API Key，
echo   再点「快速测试」确认能通。
echo ==========================================
echo.
ping -n 9 127.0.0.1 >nul
exit /b 0
