import cheerio from 'cheerio';
import {promises as fs} from 'fs';
import minimist from 'minimist';
import mkdirp from 'mkdirp';
import path from 'path';
import request from 'request';

const args = minimist(process.argv.slice(2));
const PROJECT = args.project;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class BadStatusError extends Error {
  constructor (status: number, uri: string, body: string) {
    super(`Bad status ${status} from ${uri}: ${body}`);
  }
}

const req = (cfg: request.CoreOptions & request.RequiredUriUrl): Promise<string> => new Promise((resolve, reject) => {
  request(cfg, (error, response, body) => {
    if (error) {
      return reject(error);
    }

    if (response.statusCode < 200 || response.statusCode > 299) {
      throw new BadStatusError(response.statusCode, response.url ?? '<unknown URL>', body);
    }

    resolve(body);
  });
});

const cached = async (key: string, fn: () => Promise<string>) => {
  await mkdirp(path.join(__dirname, 'cache'));
  try {
    return await fs.readFile(path.join(__dirname, 'cache', key), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
  const res = await fn();
  await fs.writeFile(path.join(__dirname, 'cache', key), res);
  return res;
};

const fetch = async ({
  headers,
  uri,
  jitter = 250,
}: {
  headers?: { [name: string]: string };
  uri: string;
  jitter?: number;
}): Promise<CheerioStatic> => {
  for (let no = 0; ; no++) {
    await delay(Math.random() * jitter);

    let body: string;
    try {
      body = await cached(uri.replace(/\//g, '_'), () => req({
        headers,
        uri,
      }));
    } catch (e) {
      console.error(e.message);
      continue;
    }

    return cheerio.load(body);
  }
};

const parseNumber = (raw: string) => Number.parseInt(
  raw.replace(/,/g, ''),
  10,
);

(async () => {
  let uri: string | undefined = `https://github.com/${PROJECT}/network/dependents?dependent_type=PACKAGE`;

  const results: {
    user: string;
    project: string;
    stars: number;
    forks: number;
  }[] = [];

  while (uri) {
    await delay(Math.random() * 4000 + 1000);
    const $: CheerioStatic = await fetch({
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0',
      },
      uri,
    });
    console.log(`Fetched ${uri}`);

    $('#dependents .Box-row').each((_, row) => {
      const $row = $(row);
      const user = $row.find('a[data-hovercard-type=user], a[data-hovercard-type=organization]').text();
      const project = $row.find('a[data-hovercard-type=repository]').text();
      const stars = parseNumber($row.find('.octicon-star').parent().text());
      const forks = parseNumber($row.find('.octicon-repo-forked').parent().text());
      results.push({user, project, stars, forks});
    });

    uri = $('#dependents .paginate-container a.btn:nth-child(2)').attr('href');

    await fs.writeFile(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  }

  console.log('Done');
})()
  .catch(console.error);
