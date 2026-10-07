# GetFit legal pages

The privacy policy and support page linked from the GetFit app and its App
Store listing, served by GitHub Pages:

- https://elshaab.github.io/github-slideshow/privacy.html
- https://elshaab.github.io/github-slideshow/support.html

Do not edit these files here. They are generated from `PRIVACY.md` and
`SUPPORT.md` in the private `ElShaab/getfit` repository by
`npm run legal --workspace @getfit/mobile`, which writes them to `site/`.
Copy the two files from there to this branch to publish a change.

Do not delete, rename or move them: every shipped build links to these URLs.

## Exercise videos

`videos/v1/` holds a demonstration video (`<exercise id>.mp4`) and a still
(`<exercise id>.jpg`) for every exercise. The app downloads each one the first
time its exercise is opened, from
`https://elshaab.github.io/github-slideshow/videos/v1/`. Never overwrite or
delete a published version — phones keep their downloaded copies. A new set
goes under `videos/v2/`, alongside (see RELEASE.md in the getfit repository,
"Exercise videos").
