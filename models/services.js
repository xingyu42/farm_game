import Data from './Data.js'
import Puppeteer from './puppeteer.js'

const puppeteer = new Puppeteer(logger)

export {
  Data,
  puppeteer as Puppeteer
}