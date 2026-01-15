@echo off
chcp 65001 > nul
echo ==========================================
echo ClipNest ビルド & EXE化ツール
echo ==========================================

echo.
echo [1/2] ソースコードをビルド中... (npm run build)
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] ビルドに失敗しました。
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] EXEを作成中... (npm run package)
call npm run package
if %errorlevel% neq 0 (
    echo [ERROR] パッケージングに失敗しました。
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo 完了しました！
echo EXEファイルは 'dist' フォルダ内に作成されました。
echo ==========================================
pause
